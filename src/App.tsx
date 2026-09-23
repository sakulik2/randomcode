import { useCallback, useEffect, useRef, useState } from 'react'
import { Controls } from './components/Controls.tsx'
import { EmptyState, Notice } from './components/Notice.tsx'
import { RepoCard } from './components/RepoCard.tsx'
import { TerminalView } from './components/TerminalView.tsx'
import { TokenField } from './components/TokenField.tsx'
import { BATCH_SIZE, draw, drawFromPool } from './lib/draw.ts'
import { ApiError, loadToken, saveToken } from './lib/github.ts'
import { newSeed } from './lib/random.ts'
import type { DrawMode, EraBias, Failure, Quota, Repo, Resource } from './lib/types.ts'

type Theme = 'press' | 'terminal'

const THEME_KEY = 'randomcode.theme'

/** Seed and settings ride in the URL so a batch can be shared and reproduced. */
function readUrl(): {
  seed: string | null
  minStars: number
  eraBias: EraBias
  deep: boolean
} {
  const p = new URLSearchParams(location.search)
  const stars = Number(p.get('stars'))
  return {
    seed: p.get('seed'),
    minStars: Number.isFinite(stars) && stars >= 0 ? stars : 5,
    eraBias: p.get('era') === 'volume' ? 'volume' : 'time',
    deep: p.get('deep') === '1',
  }
}

function writeUrl(seed: string, minStars: number, eraBias: EraBias, deep: boolean): void {
  const p = new URLSearchParams({ seed, stars: String(minStars), era: eraBias })
  if (deep) p.set('deep', '1')
  history.replaceState(null, '', `?${p.toString()}`)
}

function loadTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'terminal' ? 'terminal' : 'press'
  } catch {
    return 'press'
  }
}

export default function App() {
  const initial = useRef(readUrl())

  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [token, setToken] = useState(loadToken)
  const [minStars, setMinStars] = useState(initial.current.minStars)
  const [eraBias, setEraBias] = useState<EraBias>(initial.current.eraBias)
  const [deep, setDeep] = useState(initial.current.deep)

  const [repos, setRepos] = useState<Repo[]>([])
  const [pool, setPool] = useState<Repo[]>([])
  const [seed, setSeed] = useState(initial.current.seed ?? '')
  const [provenance, setProvenance] = useState('')
  /*
   * Quota per bucket. Deep mode spends core on the id listing and search on
   * hydration, and the limits differ by an order of magnitude, so collapsing
   * them into one figure would report the wrong wait.
   */
  const [quotas, setQuotas] = useState<Partial<Record<Resource, Quota>>>({})
  const [failure, setFailure] = useState<Failure | null>(null)
  const [busy, setBusy] = useState(false)
  const [registered, setRegistered] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Storage can be blocked; the theme just won't persist.
    }
  }, [theme])

  const run = useCallback(
    async (
      nextSeed: string,
      stars: number,
      era: EraBias,
      isDeep: boolean,
      usePool: boolean,
    ) => {
      setBusy(true)
      setFailure(null)
      setRegistered(false)

      try {
        const mode: DrawMode = isDeep ? 'deep' : stars > 0 ? 'curated' : 'raw'
        /*
         * A full pool serves the batch outright and skips the expensive request.
         * A partial one — the pool drains 12 at a time out of ~88, so a remainder
         * always survives — rides along with the next request instead of being
         * overwritten by it. Those leftovers already cost quota to fetch.
         */
        const canServeFromPool = usePool && pool.length >= BATCH_SIZE
        const result = canServeFromPool
          ? await drawFromPool(pool, nextSeed, token)
          : await draw(
              { mode, minStars: stars, eraBias: era, seed: nextSeed },
              token,
              usePool ? pool : [],
            )

        setRepos(result.repos)
        setPool(result.pool)
        setProvenance(result.provenance)
        setQuotas((prev) => ({ ...prev, ...result.quotas }))
        setSeed(nextSeed)
        writeUrl(nextSeed, stars, era, isDeep)
        // Let the ink layers slide into register once the batch is on screen.
        requestAnimationFrame(() => setRegistered(true))
      } catch (err) {
        if (err instanceof ApiError) {
          setFailure(err.failure)
          // Mark the bucket that actually ran dry, so the countdown is the right one.
          const { resetAt, resource } = err.failure
          if (err.failure.kind === 'quota' && resetAt && resource) {
            setQuotas((prev) => {
              const known = prev[resource]
              return {
                ...prev,
                [resource]: { limit: known?.limit ?? 0, remaining: 0, resetAt },
              }
            })
          }
        } else {
          setFailure({ kind: 'unknown', message: '抽取过程中断了。再点一次试试。' })
        }
      } finally {
        setBusy(false)
      }
    },
    [pool, token],
  )

  const onDraw = useCallback(() => {
    void run(newSeed(), minStars, eraBias, deep, true)
  }, [run, minStars, eraBias, deep])

  // Reproduce a shared link's batch on first load.
  useEffect(() => {
    if (initial.current.seed) {
      void run(
        initial.current.seed,
        initial.current.minStars,
        initial.current.eraBias,
        initial.current.deep,
        false,
      )
    }
    // Deliberately once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onMinStars = useCallback((n: number) => {
    setMinStars(n)
    // A different floor needs a different query; the pool no longer matches.
    setPool([])
  }, [])

  const onEraBias = useCallback((b: EraBias) => {
    setEraBias(b)
    setPool([])
  }, [])

  /*
   * Deep mode draws from the id space instead of search, so pooled results from
   * the other mode don't belong to the new query either way.
   */
  const onDeep = useCallback((next: boolean) => {
    setDeep(next)
    setPool([])
  }, [])

  const onSaveToken = useCallback((next: string) => {
    saveToken(next)
    setToken(next)
    setQuotas({})
  }, [])

  return (
    <div className="shell">
      <header className="masthead">
        <span className="masthead__run">
          {seed ? (
            <>
              第 <b>#{seed}</b> 批
            </>
          ) : (
            '随机仓库印刷所'
          )}
        </span>
        <span className="masthead__tools">
          <span className="segment" role="group" aria-label="显示方式">
            <button
              type="button"
              aria-pressed={theme === 'press'}
              onClick={() => setTheme('press')}
            >
              印刷版
            </button>
            <button
              type="button"
              aria-pressed={theme === 'terminal'}
              onClick={() => setTheme('terminal')}
            >
              终端版
            </button>
          </span>
          <TokenField token={token} onSave={onSaveToken} />
        </span>
      </header>

      <section className="hero">
        <h1 className="hero__title" data-registered={registered}>
          <span className="hero__word" data-word="随机">
            随机
          </span>
          <br />
          <span className="hero__word" data-word="捞仓库">
            捞仓库
          </span>
        </h1>
        <p className="hero__lede">
          每次 {BATCH_SIZE} 个公开仓库，可能来自 2008 年至今的任何一天。
          没有推荐算法，没有热榜，抽到什么就是什么。
        </p>
      </section>

      <Controls
        minStars={minStars}
        onMinStars={onMinStars}
        eraBias={eraBias}
        onEraBias={onEraBias}
        deep={deep}
        onDeep={onDeep}
        onDraw={onDraw}
        busy={busy}
        quotas={quotas}
        poolSize={pool.length}
      />

      {failure && <Notice failure={failure} />}

      {repos.length === 0 && !failure && !busy && <EmptyState />}

      {repos.length > 0 &&
        (theme === 'terminal' ? (
          <TerminalView
            repos={repos}
            seed={seed}
            minStars={minStars}
            eraBias={eraBias}
            deep={deep}
          />
        ) : (
          <section className="sheet" aria-label={`第 ${seed} 批，共 ${repos.length} 个仓库`}>
            {repos.map((repo) => (
              <RepoCard key={repo.id} repo={repo} />
            ))}
          </section>
        ))}

      {provenance && (
        <footer className="colophon">
          <span>{provenance}</span>
          <span>
            这一批的链接可以直接分享，种子 #{seed} 会抽出同样的结果。
          </span>
        </footer>
      )}
    </div>
  )
}
