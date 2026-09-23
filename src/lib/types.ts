/** A repository, trimmed to what a card actually shows. */
export interface Repo {
  id: number
  fullName: string
  owner: string
  name: string
  url: string
  description: string | null
  language: string | null
  stars: number
  forks: number
  topics: string[]
  license: string | null
  createdAt: string
  pushedAt: string
  isFork: boolean
  isArchived: boolean
  /** False for deep-water results that haven't been hydrated with search metadata. */
  hydrated: boolean
}

/** Remaining quota for one GitHub rate-limit bucket, read from response headers. */
export interface Quota {
  remaining: number
  limit: number
  /** Unix seconds when the bucket refills. */
  resetAt: number
}

export type Resource = 'search' | 'core'

export type DrawMode = 'curated' | 'raw' | 'deep'

/** Uniform over calendar time surfaces old repos; uniform over repos skews recent. */
export type EraBias = 'time' | 'volume'

export interface DrawParams {
  mode: DrawMode
  /** Star floor. 0 means no star qualifier at all — true raw randomness. */
  minStars: number
  eraBias: EraBias
  /** Hex seed; the "print run" number shown in the UI. */
  seed: string
}

export type FailureKind =
  | 'quota'
  | 'network'
  | 'empty'
  | 'unauthorized'
  | 'unknown'

export interface Failure {
  kind: FailureKind
  message: string
  /** Unix seconds; present for quota failures. */
  resetAt?: number
}
