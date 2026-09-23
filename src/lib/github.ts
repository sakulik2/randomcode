/**
 * GitHub API client.
 *
 * No backend needed: api.github.com sends `Access-Control-Allow-Origin: *` and
 * exposes the `X-RateLimit-*` headers to browsers, so the page can call it
 * directly and still report real remaining quota.
 *
 * Unauthenticated limits, measured: search 10/min, core 60/hour.
 */

import type { Failure, Quota, Repo, Resource } from './types.ts'
import { MAX_REPO_ID } from './sample.ts'

const API = 'https://api.github.com'
const TOKEN_KEY = 'randomcode.token'

export function loadToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveToken(token: string): void {
  try {
    const trimmed = token.trim()
    if (trimmed) localStorage.setItem(TOKEN_KEY, trimmed)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Private browsing can block storage; running without a token still works.
  }
}

function headers(token: string): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

function readQuota(res: Response): Quota | null {
  const remaining = res.headers.get('x-ratelimit-remaining')
  const limit = res.headers.get('x-ratelimit-limit')
  const reset = res.headers.get('x-ratelimit-reset')
  if (remaining === null || limit === null || reset === null) return null
  return { remaining: Number(remaining), limit: Number(limit), resetAt: Number(reset) }
}

export class ApiError extends Error {
  readonly failure: Failure
  constructor(failure: Failure) {
    super(failure.message)
    this.name = 'ApiError'
    this.failure = failure
  }
}

export interface ApiResult<T> {
  data: T
  quota: Quota | null
  resource: Resource
}

async function request<T>(path: string, token: string, resource: Resource): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, { headers: headers(token) })
  } catch {
    throw new ApiError({
      kind: 'network',
      message: '连不上 GitHub。检查一下网络，然后再抽一次。',
    })
  }

  const quota = readQuota(res)

  if (res.ok) {
    return { data: (await res.json()) as T, quota, resource }
  }

  if (res.status === 401) {
    throw new ApiError({
      kind: 'unauthorized',
      message: 'token 被 GitHub 拒了。清掉它就能继续用免 token 模式。',
    })
  }

  // 403/429 with an exhausted bucket is quota, not permission.
  if ((res.status === 403 || res.status === 429) && quota && quota.remaining === 0) {
    throw new ApiError({
      kind: 'quota',
      message: resource === 'search' ? '搜索配额用完了' : '接口配额用完了',
      resetAt: quota.resetAt,
      resource,
    })
  }

  const retryAfter = res.headers.get('retry-after')
  if (res.status === 429 || (res.status === 403 && retryAfter)) {
    throw new ApiError({
      kind: 'quota',
      message: 'GitHub 让我们慢一点',
      resetAt: Math.floor(Date.now() / 1000) + Number(retryAfter ?? 60),
      resource,
    })
  }

  let detail = ''
  try {
    const body = (await res.json()) as { message?: string }
    detail = body.message ?? ''
  } catch {
    // Non-JSON error body; the status code is all we have.
  }
  throw new ApiError({
    kind: 'unknown',
    message: detail ? `GitHub 返回 ${res.status}：${detail}` : `GitHub 返回 ${res.status}。`,
  })
}

/** Shape of the fields this app reads off a search result. */
interface RawRepo {
  id: number
  full_name: string
  owner: { login: string } | null
  html_url: string
  name: string
  description: string | null
  language: string | null
  stargazers_count?: number
  forks_count?: number
  topics?: string[]
  license?: { spdx_id?: string | null } | null
  created_at?: string
  pushed_at?: string
  fork: boolean
  archived?: boolean
}

function toRepo(raw: RawRepo, hydrated: boolean): Repo {
  return {
    id: raw.id,
    fullName: raw.full_name,
    owner: raw.owner?.login ?? raw.full_name.split('/')[0] ?? '',
    name: raw.name,
    url: raw.html_url,
    description: raw.description,
    language: raw.language,
    stars: raw.stargazers_count ?? 0,
    forks: raw.forks_count ?? 0,
    topics: raw.topics ?? [],
    license: raw.license?.spdx_id && raw.license.spdx_id !== 'NOASSERTION' ? raw.license.spdx_id : null,
    createdAt: raw.created_at ?? '',
    pushedAt: raw.pushed_at ?? '',
    isFork: raw.fork,
    isArchived: raw.archived ?? false,
    hydrated,
  }
}

interface SearchResponse {
  total_count: number
  items: RawRepo[]
}

export interface SearchOutcome {
  totalCount: number
  repos: Repo[]
  quota: Quota | null
}

/**
 * One search request. Always asks for 100 — the extras become the reserve pool,
 * which is what stretches 10 requests/min into far more draws.
 */
export async function searchRepos(
  opts: { q: string; sort?: string; order?: string; page: number; token: string },
): Promise<SearchOutcome> {
  const params = new URLSearchParams({
    q: opts.q,
    per_page: '100',
    page: String(opts.page),
  })
  if (opts.sort) params.set('sort', opts.sort)
  if (opts.order) params.set('order', opts.order)

  const { data, quota } = await request<SearchResponse>(
    `/search/repositories?${params.toString()}`,
    opts.token,
    'search',
  )
  return {
    totalCount: data.total_count,
    repos: data.items.map((r) => toRepo(r, true)),
    quota,
  }
}

/**
 * Deep water: `/repositories?since=<random id>` walks the raw id space, which is
 * the only truly unbiased sample available. It runs on the core bucket (60/hour)
 * and returns sparse rows — no stars, no language, no topics, and about a third
 * are forks — so results need hydrating before display.
 */
export async function listFromIdSpace(
  opts: { since: number; token: string },
): Promise<{ repos: Repo[]; quota: Quota | null }> {
  const { data, quota } = await request<RawRepo[]>(
    `/repositories?since=${opts.since}`,
    opts.token,
    'core',
  )
  return { repos: data.map((r) => toRepo(r, false)), quota }
}

/** Highest id worth asking for, leaving a page of room above it. */
export const ID_CEILING = MAX_REPO_ID

/**
 * Fill in metadata for sparse repos. Search accepts stacked `repo:` qualifiers,
 * so one request covers a whole screen of cards. Measured ceiling is around a
 * dozen per query; GitHub silently drops any repo it can't resolve, so results
 * are matched back by name rather than by position.
 */
export async function hydrateRepos(
  repos: readonly Repo[],
  token: string,
): Promise<{ repos: Repo[]; quota: Quota | null }> {
  if (repos.length === 0) return { repos: [], quota: null }

  const batch = repos.slice(0, 12)
  const q = batch.map((r) => `repo:${r.fullName}`).join(' ')

  let outcome: SearchOutcome
  try {
    outcome = await searchRepos({ q, page: 1, token })
  } catch (err) {
    // Hydration is an enhancement. If it fails, show the sparse rows.
    if (err instanceof ApiError && err.failure.kind === 'quota') {
      return { repos: repos.slice(), quota: null }
    }
    throw err
  }

  const byName = new Map(outcome.repos.map((r) => [r.fullName.toLowerCase(), r]))
  const merged = repos.map((r) => byName.get(r.fullName.toLowerCase()) ?? r)
  return { repos: merged, quota: outcome.quota }
}

/** Current quota without spending any of it — /rate_limit is free and CORS-open. */
export async function fetchQuota(
  token: string,
): Promise<{ search: Quota; core: Quota }> {
  interface RateLimitResponse {
    resources: {
      search: { limit: number; remaining: number; reset: number }
      core: { limit: number; remaining: number; reset: number }
    }
  }
  const { data } = await request<RateLimitResponse>('/rate_limit', token, 'core')
  const pick = (r: { limit: number; remaining: number; reset: number }): Quota => ({
    limit: r.limit,
    remaining: r.remaining,
    resetAt: r.reset,
  })
  return { search: pick(data.resources.search), core: pick(data.resources.core) }
}
