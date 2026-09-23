import { STAR_STEPS } from '../lib/sample.ts'
import type { EraBias, Quota } from '../lib/types.ts'

/** What a given star floor actually yields — measured, not guessed. */
function floorNote(minStars: number): string {
  if (minStars === 0) return '没有门槛。大部分会是 0 星的练习和作业仓库，这就是 GitHub 的真实样貌。'
  if (minStars <= 2) return '刚够滤掉空仓库，出来的东西依然很野。'
  if (minStars <= 10) return '基本都有描述和语言标注了。'
  if (minStars <= 100) return '有人用过的项目。'
  return '门槛很高，时间窗会自动放宽来凑够数量。'
}

function secondsUntil(resetAt: number): number {
  return Math.max(0, resetAt - Math.floor(Date.now() / 1000))
}

export function Controls({
  minStars,
  onMinStars,
  eraBias,
  onEraBias,
  onDraw,
  busy,
  quota,
  poolSize,
}: {
  minStars: number
  onMinStars: (n: number) => void
  eraBias: EraBias
  onEraBias: (b: EraBias) => void
  onDraw: () => void
  busy: boolean
  quota: Quota | null
  poolSize: number
}) {
  const stepIndex = Math.max(0, STAR_STEPS.indexOf(minStars))

  return (
    <section className="controls" aria-label="抽取设置">
      <button className="draw" onClick={onDraw} disabled={busy}>
        {busy ? '正在抽…' : '抽一批'}
      </button>

      <div className="slider">
        <label className="slider__head" htmlFor="floor">
          <span>星数门槛</span>
          <span className="slider__value">
            {minStars === 0 ? '不设门槛' : `${minStars} 星起`}
          </span>
        </label>
        <input
          id="floor"
          type="range"
          min={0}
          max={STAR_STEPS.length - 1}
          step={1}
          value={stepIndex}
          onChange={(e) => onMinStars(STAR_STEPS[Number(e.target.value)] ?? 0)}
        />
        <p className="slider__note">{floorNote(minStars)}</p>
      </div>

      <div className="quota">
        <div className="segment" role="group" aria-label="年代偏好">
          <button
            type="button"
            aria-pressed={eraBias === 'time'}
            onClick={() => onEraBias('time')}
          >
            跨越各年代
          </button>
          <button
            type="button"
            aria-pressed={eraBias === 'volume'}
            onClick={() => onEraBias('volume')}
          >
            偏向近几年
          </button>
        </div>

        {quota ? (
          <>
            <QuotaTicks quota={quota} />
            <span>
              搜索配额还剩 <b>{quota.remaining}</b> 次
              {quota.remaining === 0 && `，${secondsUntil(quota.resetAt)} 秒后恢复`}
            </span>
          </>
        ) : (
          <span>还没查过配额</span>
        )}
        {poolSize > 0 && <span>手上还存着 {poolSize} 个，再抽不花配额</span>}
      </div>
    </section>
  )
}

function QuotaTicks({ quota }: { quota: Quota }) {
  // Cap the ticks so a token's 30/min doesn't stretch the row.
  const total = Math.min(quota.limit, 10)
  const on = Math.round((quota.remaining / Math.max(quota.limit, 1)) * total)
  return (
    <span className="quota__bar" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span className="quota__tick" key={i} data-on={i < on} />
      ))}
    </span>
  )
}
