import { useCallback, useEffect, useRef, useState } from 'react'
import { Controls } from './components/Controls.tsx'
import { EmptyState, Notice } from './components/Notice.tsx'
import { RepoCard } from './components/RepoCard.tsx'
import { TerminalView } from './components/TerminalView.tsx'
import { TokenField } from './components/TokenField.tsx'
import { BATCH_SIZE, draw, drawFromPool } from './lib/draw.ts'
import { ApiError, loadToken, saveToken } from './lib/github.ts'
import { newSeed } from './lib/random.ts'
import type { EraBias, Failure, Quota, Repo } from './lib/types.ts'

type Theme = 'press' | 'terminal'

const THEME_KEY = 'randomcode.theme'

/** Seed and settings ride in the URL so a batch can be shared and reproduced. */
function readUrl(): { seed: string | null; minStars: number; eraBias: EraBias } {
  const p = new URLSearchParams(location.search)
  const stars = Number(p.get('stars'))
  return {
    seed: p.get('seed'),
    minStars: Number.isFinite(stars) && stars >= 0 ? stars : 5,
    eraBias: p.get('era') === 'volume' ? 'volume' : 'time',
  }
}

function writeUrl(seed: string, minStars: number, eraBias: EraBias): void {
  const p = new URLSearchParams({ seed, stars: String(minStars), era: eraBias })
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

  const [repos, setRepos] = useState<Repo[]>([])
  const [pool, setPool] = useState<Repo[]>([])
  const [seed, setSeed] = useState(initial.current.seed ?? '')
  const [provenance, setProvenance] = useState('')
  const [quota, setQuota] = useState<Quota | null>(null)
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
    async (nextSeed: string, stars: number, era: EraBias, usePool: boolean) => {
      setBusy(true)
      setFailure(null)
      setRegistered(false)

      try {
        // A pool draw costs no quota — this is what stretches 10 requests/min.
        const result =
          usePool && pool.length >= BATCH_SIZE
            ? drawFromPool(pool, nextSeed)
            : await draw({ mode: stars > 0 ? 'curated' : 'raw', minStars: stars, eraBias: era, seed: nextSeed }, token)

        setRepos(result.repos)
        setPool(result.pool)
        setProvenance(result.provenance)
        if (result.quota) setQuota(result.quota)
        setSeed(nextSeed)
        writeUrl(nextSeed, stars, era)
        // Let the ink layers slide into register once the batch is on screen.
        requestAnimationFrame(() => setRegistered(true))
      } catch (err) {
        if (err instanceof ApiError) {
          setFailure(err.failure)
          if (err.failure.kind === 'quota' && err.failure.resetAt) {
            setQuota((q) => (q ? { ...q, remaining: 0, resetAt: err.failure.resetAt! } : q))
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
    void run(newSeed(), minStars, eraBias, true)
  }, [run, minStars, eraBias])

  // Reproduce a shared link's batch on first load.
  useEffect(() => {
    if (initial.current.seed) {
      void run(initial.current.seed, initial.current.minStars, initial.current.eraBias, false)
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

  const onSaveToken = useCallback((next: string) => {
    saveToken(next)
    setToken(next)
    setQuota(null)
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
        onDraw={onDraw}
        busy={busy}
        quota={quota}
        poolSize={pool.length}
      />

      {failure && <Notice failure={failure} />}

      {repos.length === 0 && !failure && !busy && <EmptyState />}

      {repos.length > 0 &&
        (theme === 'terminal' ? (
          <TerminalView repos={repos} seed={seed} />
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
