/**
 * Draw orchestration: turning one API request into many batches.
 *
 * Every search asks for 100 results but a sheet shows 12. The other 88 stay in a
 * reserve pool, so the next few draws cost nothing. That's what makes the
 * unauthenticated 10 requests/min workable — roughly 8 draws per request.
 */

import {
  ApiError,
  hydrateRepos,
  listFromIdSpace,
  searchRepos,
} from './github.ts'
import { buildSearchPlan, maxPage, narrowPlan, MAX_REPO_ID } from './sample.ts'
import { hashSeed, mulberry32, randomInt, shuffle } from './random.ts'
import type { DrawParams, Quota, Repo, Resource } from './types.ts'

export const BATCH_SIZE = 12

export interface DrawResult {
  repos: Repo[]
  /** Leftovers for the next draw. */
  pool: Repo[]
  /** How many of `repos` came from the previous draw's leftovers. */
  carried: number
  /**
   * Quota readings taken during this draw, keyed by bucket. Deep mode touches
   * both — the id listing spends core, hydration spends search — and the two
   * limits are far apart (60/hour vs 10/min), so one combined number would
   * misreport whichever bucket the UI happened not to show.
   */
  quotas: Partial<Record<Resource, Quota>>
  /** Describes where this batch came from, shown in the colophon. */
  provenance: string
}

/** Skip results that would render as an empty card in curated mode. */
function worthShowing(repo: Repo, minStars: number): boolean {
  if (minStars === 0) return true
  return Boolean(repo.description || repo.language || repo.topics.length > 0)
}

/**
 * Build a batch out of last draw's leftovers plus this request's harvest.
 *
 * The pool drains 12 at a time and a harvest is never a multiple of 12, so a
 * remainder always survives — 88 leftovers drain to 4, which used to be too few
 * to serve a batch and were then overwritten by the next request's results. Those
 * 4 cost quota to fetch, so they lead the next batch instead of being discarded.
 *
 * Dedupes by id: a repo can legitimately appear in two windows (or two orderings
 * of the same window), and the same card twice on one sheet reads as a bug.
 */
export function assembleBatch(
  leftovers: readonly Repo[],
  fresh: readonly Repo[],
): { repos: Repo[]; pool: Repo[]; carried: number } {
  const seen = new Set<number>()
  const repos: Repo[] = []
  const spare: Repo[] = []

  for (const repo of leftovers) {
    if (seen.has(repo.id)) continue
    seen.add(repo.id)
    if (repos.length < BATCH_SIZE) repos.push(repo)
    else spare.push(repo)
  }
  const carried = repos.length

  for (const repo of fresh) {
    if (seen.has(repo.id)) continue
    seen.add(repo.id)
    if (repos.length < BATCH_SIZE) repos.push(repo)
    else spare.push(repo)
  }

  return { repos, pool: spare, carried }
}

/**
 * Curated and raw modes both run on search; the only difference is whether a
 * star qualifier is attached. Raw keeps everything, including the zero-star
 * coursework that makes up most of GitHub — that's the honest sample, and seeing
 * it is how you know the randomness isn't staged.
 */
async function drawFromSearch(
  params: DrawParams,
  token: string,
  leftovers: readonly Repo[] = [],
): Promise<DrawResult> {
  const rng = mulberry32(hashSeed(params.seed))

  // Widen the window and retry when a window comes back empty — old eras are
  // sparse enough that a first pick can genuinely contain nothing.
  for (let attempt = 0; attempt < 4; attempt++) {
    const widen = attempt === 0 ? 1 : 2 ** attempt * 3
    let plan = buildSearchPlan(rng, params.minStars, params.eraBias, widen)

    const probe = await searchRepos({
      q: plan.q,
      sort: plan.sort,
      order: plan.order,
      page: 1,
      token,
    })

    if (probe.totalCount === 0) continue

    let total = probe.totalCount
    let harvest = probe.repos
    let quota = probe.quota

    /*
     * Past 1000 results the rest of the window is unreachable, so paging would
     * only ever sample its top slice. Narrowing to a proportionally shorter
     * window brings the whole thing back within reach — worth one request, since
     * it's the difference between a uniform sample and a popularity ranking.
     */
    if (total > 1000) {
      plan = narrowPlan(plan, params.minStars, total)
      const narrowed = await searchRepos({
        q: plan.q,
        sort: plan.sort,
        order: plan.order,
        page: 1,
        token,
      })
      if (narrowed.totalCount > 0) {
        total = narrowed.totalCount
        harvest = narrowed.repos
        quota = narrowed.quota
      }
    }

    // Page 1 is already in hand; only spend a request when a deeper page exists.
    const highest = maxPage(total, 100)
    const page = randomInt(rng, 1, highest)

    /*
     * A window's last page is usually partial — landing on it yielded 6 cards
     * where 12 were wanted. Page 1 is already paid for, so it backfills the
     * shortfall: the chosen page still supplies the batch, and the sheet fills.
     */
    let backfill: Repo[] = []
    if (page > 1) {
      const deeper = await searchRepos({
        q: plan.q,
        sort: plan.sort,
        order: plan.order,
        page,
        token,
      })
      if (deeper.repos.length > 0) {
        backfill = harvest
        harvest = deeper.repos
        quota = deeper.quota
      }
    }

    const usable = harvest.filter((r) => worthShowing(r, params.minStars))
    if (usable.length === 0) continue

    const shuffled = shuffle(usable, rng)
    if (shuffled.length < BATCH_SIZE && backfill.length > 0) {
      const seen = new Set(shuffled.map((r) => r.id))
      const extra = shuffle(
        backfill.filter((r) => !seen.has(r.id) && worthShowing(r, params.minStars)),
        rng,
      )
      shuffled.push(...extra)
    }
    const windowLabel = plan.window.start.toISOString().slice(0, 10)
    const capped = total > 1000 ? '，只有前 1000 个能翻到' : ''
    const batch = assembleBatch(leftovers, shuffled)
    const carriedNote = batch.carried > 0 ? `，另有 ${batch.carried} 个是上次存下的` : ''
    return {
      repos: batch.repos,
      pool: batch.pool,
      carried: batch.carried,
      quotas: quota ? { search: quota } : {},
      provenance:
        `时间窗 ${windowLabel} 起 ${formatMinutes(plan.window.minutes)}，` +
        `窗内 ${total.toLocaleString('zh-CN')} 个仓库${capped}，抽的是第 ${page} 页` +
        carriedNote,
    }
  }

  throw new ApiError({
    kind: 'empty',
    message:
      params.minStars > 0
        ? `连着几个时间窗都没有 ${params.minStars} 星以上的仓库。把门槛调低点就有了。`
        : '连着几个时间窗都是空的。再抽一次就好。',
  })
}

/**
 * Deep water: walk the raw id space. This is the only genuinely unbiased sample
 * — `/repositories?since=` steps through ids with no ranking at all — but the
 * rows are sparse, so one stacked `repo:` search fills in the metadata.
 */
async function drawFromIdSpace(
  params: DrawParams,
  token: string,
  leftovers: readonly Repo[] = [],
): Promise<DrawResult> {
  const rng = mulberry32(hashSeed(params.seed))
  const since = randomInt(rng, 1, MAX_REPO_ID)

  const listing = await listFromIdSpace({ since, token })
  if (listing.repos.length === 0) {
    throw new ApiError({
      kind: 'empty',
      message: '这段 id 区间是空的。再抽一次会换一段。',
    })
  }

  /*
   * A listing returns 100 rows for one core request, and core is the tighter
   * bucket here — 60/hour against search's 600. So the leftovers pool the same
   * way search results do, and a later deep draw only pays the search request
   * that hydrates it. That turns one listing into several draws against the
   * bucket that runs out first.
   */
  const shuffled = shuffle(listing.repos, rng)

  /*
   * Assemble before hydrating, not after. Deep-water leftovers are raw listing
   * rows with no stars or language, so they have to be inside the batch that the
   * single stacked `repo:` request fills in — hydrating the fresh rows first and
   * prepending the leftovers afterwards would leave the carried ones sparse.
   */
  const batch = assembleBatch(leftovers, shuffled)
  const filled = await hydrateRepos(batch.repos, token)

  const quotas: Partial<Record<Resource, Quota>> = {}
  if (listing.quota) quotas.core = listing.quota
  if (filled.quota) quotas.search = filled.quota

  const carriedNote = batch.carried > 0 ? `，其中 ${batch.carried} 个是上次存下的` : ''
  return {
    repos: filled.repos,
    pool: batch.pool,
    carried: batch.carried,
    quotas,
    provenance:
      `从仓库 id ${since.toLocaleString('zh-CN')} 往后数，没有任何排序介入` + carriedNote,
  }
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时`
  return `${Math.round(minutes / (60 * 24))} 天`
}

/**
 * Take a batch from the pool.
 *
 * Search-mode rows arrive complete, so this costs nothing at all. Deep-water
 * rows come from the id listing with no stars, language or topics, so they still
 * need the one search request that fills them in — but they skip the core
 * request, which is the bucket deep mode actually runs out of.
 */
export async function drawFromPool(
  pool: readonly Repo[],
  seed: string,
  token: string,
): Promise<DrawResult> {
  const rng = mulberry32(hashSeed(seed))
  const shuffled = shuffle(pool, rng)
  const picked = shuffled.slice(0, BATCH_SIZE)

  if (picked.every((r) => r.hydrated)) {
    return {
      repos: picked,
      pool: shuffled.slice(BATCH_SIZE),
      carried: picked.length,
      quotas: {},
      provenance: '来自上一次请求存下的仓库，这次没花配额',
    }
  }

  const filled = await hydrateRepos(picked, token)
  return {
    repos: filled.repos,
    pool: shuffled.slice(BATCH_SIZE),
    carried: picked.length,
    quotas: filled.quota ? { search: filled.quota } : {},
    provenance: '来自上一次 id 列表存下的仓库，只花了一次搜索配额',
  }
}

/**
 * `leftovers` are the pooled repos too few in number to fill a batch on their
 * own. They lead the returned batch so a partial remainder is spent rather than
 * discarded — see `assembleBatch`.
 */
export async function draw(
  params: DrawParams,
  token: string,
  leftovers: readonly Repo[] = [],
): Promise<DrawResult> {
  if (params.mode === 'deep') return drawFromIdSpace(params, token, leftovers)
  return drawFromSearch(params, token, leftovers)
}
