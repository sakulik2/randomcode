import type { Repo } from '../lib/types.ts'
import { inkFor, weightFor } from '../lib/ink.ts'

/** "3 天前" / "2 年前" — relative time reads faster than a date on a card. */
function ago(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 60) return `${Math.max(mins, 1)} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.floor(months / 12)} 年前`
}

function stars(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function RepoCard({ repo }: { repo: Repo }) {
  const weight = weightFor(repo.stars)
  const ink = inkFor(repo.language)
  const pushed = ago(repo.pushedAt)

  return (
    <a
      className="card"
      data-weight={weight}
      data-ink={ink}
      href={repo.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="card__flag" aria-hidden="true" />

      <span className="card__lang">
        <span className="card__swatch" aria-hidden="true" />
        {repo.language ?? '没标语言'}
        {repo.isFork && <span className="card__tag">派生</span>}
        {repo.isArchived && <span className="card__tag">已归档</span>}
      </span>

      <h3 className="card__name">
        <span className="card__owner">{repo.owner}/</span>
        {repo.name}
      </h3>

      {/* Description comes from an untrusted source; React escapes it. */}
      <p className="card__desc" data-empty={repo.description ? 'false' : 'true'}>
        {repo.description ?? '作者没写描述'}
      </p>

      <span className="card__foot">
        <span className="card__stars">
          {stars(repo.stars)} 星<span className="visually-hidden">，</span>
        </span>
        {repo.forks > 0 && <span>{stars(repo.forks)} 派生</span>}
        {repo.license && <span className="card__tag">{repo.license}</span>}
        {pushed && <span>更新于 {pushed}</span>}
      </span>
    </a>
  )
}
