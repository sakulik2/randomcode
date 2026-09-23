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
import type { DrawParams, Quota, Repo } from './types.ts'

export const BATCH_SIZE = 12

export interface DrawResult {
  repos: Repo[]
  /** Leftovers for the next draw. */
  pool: Repo[]
  quota: Quota | null
  /** Describes where this batch came from, shown in the colophon. */
  provenance: string
}

/** Skip results that would render as an empty card in curated mode. */
function worthShowing(repo: Repo, minStars: number): boolean {
  if (minStars === 0) return true
  return Boolean(repo.description || repo.language || repo.topics.length > 0)
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
    return {
      repos: shuffled.slice(0, BATCH_SIZE),
      pool: shuffled.slice(BATCH_SIZE),
      quota,
      provenance:
        `时间窗 ${windowLabel} 起 ${formatMinutes(plan.window.minutes)}，` +
        `窗内 ${total.toLocaleString('zh-CN')} 个仓库${capped}，抽的是第 ${page} 页`,
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

  const picked = shuffle(listing.repos, rng).slice(0, BATCH_SIZE)
  const filled = await hydrateRepos(picked, token)

  return {
    repos: filled.repos,
    pool: [],
    quota: filled.quota ?? listing.quota,
    provenance: `从仓库 id ${since.toLocaleString('zh-CN')} 往后数，没有任何排序介入`,
  }
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时`
  return `${Math.round(minutes / (60 * 24))} 天`
}

/** Take a batch from the pool. No request, no quota spent. */
export function drawFromPool(pool: readonly Repo[], seed: string): DrawResult {
  const rng = mulberry32(hashSeed(seed))
  const shuffled = shuffle(pool, rng)
  return {
    repos: shuffled.slice(0, BATCH_SIZE),
    pool: shuffled.slice(BATCH_SIZE),
    quota: null,
    provenance: '来自上一次请求存下的仓库，这次没花配额',
  }
}

export async function draw(params: DrawParams, token: string): Promise<DrawResult> {
  if (params.mode === 'deep') return drawFromIdSpace(params, token)
  return drawFromSearch(params, token)
}
