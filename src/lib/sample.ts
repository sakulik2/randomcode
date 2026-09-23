/**
 * Manufacturing randomness on top of an API that has no random endpoint.
 *
 * The search API caps out at 1000 results per query, so the trick is to pick a
 * narrow random `created:` window whose total lands under that cap — then every
 * repo in the window is reachable and paging through it is genuinely uniform.
 *
 * Window width has to follow creation density, which changed by two orders of
 * magnitude over GitHub's life. These are measured counts for a one-hour window:
 *
 *   2012 →     90 repos/hour
 *   2016 →    824
 *   2020 →  2,655
 *   2026 → 13,808
 *
 * A fixed window would find almost nothing in 2012 and blow past the cap in 2026.
 */

import { randomInt } from './random.ts'
import type { EraBias } from './types.ts'

/** Repos created per hour. 2012–2026 are measured; 2008–2010 are extrapolated. */
const DENSITY_ANCHORS: ReadonlyArray<readonly [year: number, perHour: number]> = [
  [2008, 5],
  [2010, 25],
  [2012, 90],
  [2016, 824],
  [2020, 2655],
  [2026, 13808],
]

/** GitHub's first public repos. Nothing to sample before this. */
const EPOCH_MS = Date.UTC(2008, 1, 1)

/**
 * Upper bound of the sampling range, snapped to midnight UTC.
 *
 * A seed has to land on the same window every time or a shared link wouldn't
 * reproduce its batch. Deriving the range from `Date.now()` directly would shift
 * it every second, so the bound holds still for a day at a time — new repos
 * still become reachable tomorrow, and today's links stay stable. Also skips the
 * last day, since freshly created repos aren't indexed yet.
 */
function samplingCeiling(): number {
  const day = 24 * 60 * 60 * 1000
  return Math.floor(Date.now() / day) * day - day
}

/** Aim below the 1000-result cap with room for density variance within a day. */
const TARGET_RESULTS = 650

/** Windows outside this range are either pointlessly empty or unwieldy. */
const MIN_WINDOW_MINUTES = 2
const MAX_WINDOW_MINUTES = 60 * 24 * 40

/**
 * Repos per hour at a moment in time, log-interpolated between anchors since
 * growth is exponential, not linear.
 */
export function densityPerHour(at: Date): number {
  const year = at.getUTCFullYear() + at.getUTCMonth() / 12
  const first = DENSITY_ANCHORS[0] as readonly [number, number]
  const last = DENSITY_ANCHORS[DENSITY_ANCHORS.length - 1] as readonly [number, number]

  if (year <= first[0]) return first[1]
  if (year >= last[0]) return last[1]

  for (let i = 0; i < DENSITY_ANCHORS.length - 1; i++) {
    const [y0, d0] = DENSITY_ANCHORS[i] as readonly [number, number]
    const [y1, d1] = DENSITY_ANCHORS[i + 1] as readonly [number, number]
    if (year >= y0 && year <= y1) {
      const t = (year - y0) / (y1 - y0)
      return Math.exp(Math.log(d0) + t * (Math.log(d1) - Math.log(d0)))
    }
  }
  return last[1]
}

/**
 * What fraction of repos clear a star floor — calibrated for repos about five
 * years old. Measured: a one-day 2021 window held 2,231 repos at `stars:>=5`,
 * and 213 at `stars:>=100` over 2.4 days.
 */
function baseKeepRate(minStars: number): number {
  if (minStars <= 0) return 1
  if (minStars <= 1) return 0.1
  if (minStars <= 2) return 0.055
  if (minStars <= 5) return 0.027
  if (minStars <= 10) return 0.013
  if (minStars <= 50) return 0.0028
  if (minStars <= 100) return 0.0011
  if (minStars <= 500) return 0.00028
  return 0.00012
}

/**
 * Old repos clear a star floor far more often — they had years to accumulate,
 * and early GitHub was a smaller, more deliberate population.
 *
 * Measured at `stars:>=100`: 2011-era repos keep ~2.5%, 2021-era ~0.11%. A 23x
 * spread across a 3x age difference, so the curve is steep. Anchored at five
 * years and clamped at both ends, since two data points don't justify
 * extrapolating far.
 */
function ageMultiplier(at: Date, minStars: number): number {
  if (minStars <= 0) return 1
  // Same day-snapped clock as the sampling range, so window width is stable too.
  const years = (samplingCeiling() - at.getTime()) / (365.25 * 24 * 3600 * 1000)
  const ratio = Math.max(years, 0.25) / 5
  return clamp(ratio ** 2.85, 0.15, 30)
}

/** Window width, in minutes, expected to hold about TARGET_RESULTS repos. */
export function windowMinutesFor(at: Date, minStars: number): number {
  const keep = baseKeepRate(minStars) * ageMultiplier(at, minStars)
  const perHour = densityPerHour(at) * Math.min(keep, 1)
  const hours = TARGET_RESULTS / Math.max(perHour, 0.0001)
  return clamp(Math.round(hours * 60), MIN_WINDOW_MINUTES, MAX_WINDOW_MINUTES)
}

/**
 * Narrow a window toward the cap once the real count is known. The model only
 * has to get close; this correction handles the rest.
 */
export function narrowedMinutes(minutes: number, totalCount: number): number {
  const factor = TARGET_RESULTS / Math.max(totalCount, 1)
  return clamp(Math.max(1, Math.floor(minutes * factor)), MIN_WINDOW_MINUTES, MAX_WINDOW_MINUTES)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export interface TimeWindow {
  start: Date
  end: Date
  /** Width in minutes, kept so a retry can widen it. */
  minutes: number
}

/**
 * Pick a random `created:` window.
 *
 * `time` bias treats every calendar moment equally, which surfaces 2012-era
 * repos as readily as last week's. `volume` bias weights by how many repos each
 * era actually produced, so results skew heavily recent — that's the honest
 * "random repo" distribution, but it means almost everything comes from the
 * last two years.
 */
export function pickWindow(
  rng: () => number,
  minStars: number,
  eraBias: EraBias,
  widenFactor = 1,
): TimeWindow {
  const latest = samplingCeiling()
  const span = latest - EPOCH_MS

  let startMs: number
  if (eraBias === 'time') {
    startMs = EPOCH_MS + rng() * span
  } else {
    // Sample proportional to density by rejection: propose a uniform moment,
    // accept it with probability density(moment)/maxDensity.
    const maxDensity = densityPerHour(new Date(latest))
    let candidate = EPOCH_MS + rng() * span
    for (let tries = 0; tries < 24; tries++) {
      const proposal = EPOCH_MS + rng() * span
      if (rng() < densityPerHour(new Date(proposal)) / maxDensity) {
        candidate = proposal
        break
      }
    }
    startMs = candidate
  }

  const start = new Date(startMs)
  const minutes = clamp(
    Math.round(windowMinutesFor(start, minStars) * widenFactor),
    MIN_WINDOW_MINUTES,
    MAX_WINDOW_MINUTES,
  )
  const endMs = Math.min(startMs + minutes * 60_000, latest)
  return { start, end: new Date(endMs), minutes }
}

/** GitHub search wants whole seconds in ISO 8601, no milliseconds. */
function toQueryTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Sort order is part of the randomness. When a window holds more than the 1000
 * reachable results, each (sort, order) pair exposes a different slice of it —
 * eight orderings means eight times the reach, at no extra request cost.
 */
const SORTS: ReadonlyArray<readonly [sort: string, order: string]> = [
  ['stars', 'desc'],
  ['stars', 'asc'],
  ['forks', 'desc'],
  ['forks', 'asc'],
  ['updated', 'desc'],
  ['updated', 'asc'],
  ['help-wanted-issues', 'desc'],
  ['help-wanted-issues', 'asc'],
]

export interface SearchPlan {
  q: string
  sort: string
  order: string
  window: TimeWindow
}

export function buildSearchPlan(
  rng: () => number,
  minStars: number,
  eraBias: EraBias,
  widenFactor = 1,
): SearchPlan {
  const window = pickWindow(rng, minStars, eraBias, widenFactor)
  const parts = [`created:${toQueryTime(window.start)}..${toQueryTime(window.end)}`]
  if (minStars > 0) parts.push(`stars:>=${minStars}`)

  const pick = SORTS[randomInt(rng, 0, SORTS.length - 1)] as readonly [string, string]
  return { q: parts.join(' '), sort: pick[0], order: pick[1], window }
}

/**
 * Rebuild a plan over a shorter window starting at the same moment. Used after a
 * probe reveals the window holds more than the 1000 reachable results — anything
 * past the cap can't be sampled, so the window has to shrink to stay uniform.
 */
export function narrowPlan(plan: SearchPlan, minStars: number, totalCount: number): SearchPlan {
  const minutes = narrowedMinutes(plan.window.minutes, totalCount)
  const start = plan.window.start
  const end = new Date(start.getTime() + minutes * 60_000)

  const parts = [`created:${toQueryTime(start)}..${toQueryTime(end)}`]
  if (minStars > 0) parts.push(`stars:>=${minStars}`)

  return {
    q: parts.join(' '),
    sort: plan.sort,
    order: plan.order,
    window: { start, end, minutes },
  }
}

/** Highest page reachable for a result count, respecting the 1000-result cap. */
export function maxPage(totalCount: number, perPage: number): number {
  const reachable = Math.min(totalCount, 1000)
  return Math.max(1, Math.ceil(reachable / perPage))
}

/** Star floor steps for the slider. Zero is raw mode: no star qualifier at all. */
export const STAR_STEPS: readonly number[] = [0, 1, 2, 5, 10, 50, 100, 500, 1000]

/** Repo id ceiling, probed: `since=1.38e9` still returns rows, `1.4e9` is empty. */
export const MAX_REPO_ID = 1_380_000_000
