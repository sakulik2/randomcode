import type { Repo } from '../lib/types.ts'

/** The same batch as a log. One line per repo, no wrapping. */
export function TerminalView({ repos, seed }: { repos: readonly Repo[]; seed: string }) {
  const width = Math.max(...repos.map((r) => r.fullName.length), 10)

  return (
    <div className="log">
      <code>
        <span className="log__line log__dim">
          $ gh random --count {repos.length} --seed {seed}
        </span>
        <span className="log__line log__dim">
          {'  '}命中 {repos.length} 个
        </span>
        <span className="log__line">{' '}</span>

        {repos.map((repo) => (
          <span className="log__line" key={repo.id}>
            <a
              className="log__repo"
              href={repo.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {repo.fullName.padEnd(width, ' ')}
            </a>
            {'  '}
            <span className="log__stars">
              {String(repo.stars).padStart(6, ' ')} 星
            </span>
            {'  '}
            <span className="log__dim">
              {(repo.language ?? '—').padEnd(14, ' ')}
              {repo.description ? repo.description.slice(0, 48) : '(无描述)'}
            </span>
          </span>
        ))}
      </code>
    </div>
  )
}
