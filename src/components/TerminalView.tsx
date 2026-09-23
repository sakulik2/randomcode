import type { EraBias, Repo } from '../lib/types.ts'

/**
 * The same batch as a terminal session.
 *
 * Columns are a real table with fixed widths rather than strings padded with
 * spaces: descriptions arrive in any language, and CJK glyphs are double-width,
 * so character-count padding misaligns exactly where the data is most varied.
 */

function starCount(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/** The command that would have produced this batch, with the flags that shaped it. */
function commandFor(seed: string, count: number, minStars: number, eraBias: EraBias, deep: boolean): string {
  const flags = [`--seed ${seed}`, `--count ${count}`]
  if (deep) flags.push('--deep')
  else {
    flags.push(minStars > 0 ? `--min-stars ${minStars}` : '--raw')
    flags.push(`--era ${eraBias}`)
  }
  return `gh random ${flags.join(' ')}`
}

export function TerminalView({
  repos,
  seed,
  minStars,
  eraBias,
  deep,
}: {
  repos: readonly Repo[]
  seed: string
  minStars: number
  eraBias: EraBias
  deep: boolean
}) {
  return (
    <section className="term" aria-label={`第 ${seed} 批，共 ${repos.length} 个仓库`}>
      <div className="term__bar">
        <span className="term__dot" aria-hidden="true" />
        <span className="term__path">~/github</span>
        <span className="term__tag">{deep ? 'id 序列' : '时间窗'}</span>
      </div>

      <div className="term__body">
        <p className="term__cmd">
          <span className="term__prompt" aria-hidden="true">
            $
          </span>
          {commandFor(seed, repos.length, minStars, eraBias, deep)}
          <span className="term__caret" aria-hidden="true" />
        </p>

        <div className="term__scroll">
          <table className="term__table">
            <colgroup>
              <col style={{ width: '3.5ch' }} />
              <col style={{ width: '34ch' }} />
              <col style={{ width: '8ch' }} />
              <col style={{ width: '14ch' }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="term__num">
                  #
                </th>
                <th scope="col">仓库</th>
                <th scope="col" className="term__stars">
                  星
                </th>
                <th scope="col">语言</th>
                <th scope="col">描述</th>
              </tr>
            </thead>
            <tbody>
              {repos.map((repo, i) => (
                <tr key={repo.id}>
                  <td className="term__num">{i + 1}</td>
                  <td className="term__name">
                    <a href={repo.url} target="_blank" rel="noopener noreferrer">
                      {repo.fullName}
                    </a>
                    {repo.isFork && <span className="term__flag">派生</span>}
                    {repo.isArchived && <span className="term__flag">归档</span>}
                  </td>
                  {/*
                   * A deep-water row that hydration couldn't resolve has no star
                   * count at all — printing 0 would state something the API never
                   * said.
                   */}
                  <td className="term__stars" data-unknown={!repo.hydrated}>
                    {repo.hydrated ? starCount(repo.stars) : '?'}
                  </td>
                  <td className="term__lang" data-empty={!repo.language}>
                    {repo.language ?? (repo.hydrated ? '—' : '?')}
                  </td>
                  {/* Description is untrusted text; React escapes it. */}
                  <td className="term__desc" data-empty={!repo.description}>
                    {repo.description ?? '(无描述)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="term__exit">
          <span aria-hidden="true">→ </span>
          {repos.length} 行，退出码 0
        </p>
      </div>
    </section>
  )
}
