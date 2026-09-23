import { STAR_STEPS } from '../lib/sample.ts'
import type { EraBias, Quota, Resource } from '../lib/types.ts'

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

/** "3 分 20 秒" — core resets on the hour, so seconds alone stop being readable. */
function waitLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins} 分钟`
  return `${Math.floor(mins / 60)} 小时 ${mins % 60} 分钟`
}

export function Controls({
  minStars,
  onMinStars,
  eraBias,
  onEraBias,
  deep,
  onDeep,
  onDraw,
  busy,
  quotas,
  poolSize,
}: {
  minStars: number
  onMinStars: (n: number) => void
  eraBias: EraBias
  onEraBias: (b: EraBias) => void
  deep: boolean
  onDeep: (v: boolean) => void
  onDraw: () => void
  busy: boolean
  quotas: Partial<Record<Resource, Quota>>
  poolSize: number
}) {
  const stepIndex = Math.max(0, STAR_STEPS.indexOf(minStars))
  /*
   * Deep water walks the raw id space, so neither the star floor nor the era
   * bias has anything to act on — the window machinery isn't involved at all.
   * Disabling them says that plainly instead of letting them look effective.
   */
  const windowed = !deep

  return (
    <section className="controls" aria-label="抽取设置">
      <button className="draw" onClick={onDraw} disabled={busy}>
        {busy ? '正在抽…' : '抽一批'}
      </button>

      <div className="slider" data-off={deep}>
        <label className="slider__head" htmlFor="floor">
          <span>星数门槛</span>
          <span className="slider__value">
            {deep ? '深水区不看星数' : minStars === 0 ? '不设门槛' : `${minStars} 星起`}
          </span>
        </label>
        <input
          id="floor"
          type="range"
          min={0}
          max={STAR_STEPS.length - 1}
          step={1}
          value={stepIndex}
          disabled={deep}
          onChange={(e) => onMinStars(STAR_STEPS[Number(e.target.value)] ?? 0)}
        />
        <p className="slider__note">
          {deep
            ? '深水区直接按 id 顺序取仓库，不经过搜索，所以门槛和年代都用不上。'
            : floorNote(minStars)}
        </p>
      </div>

      <div className="quota">
        <div className="segment" role="group" aria-label="抽取方式">
          <button
            type="button"
            aria-pressed={windowed}
            onClick={() => onDeep(false)}
          >
            搜索
          </button>
          <button
            type="button"
            aria-pressed={deep}
            onClick={() => onDeep(true)}
          >
            深水区
          </button>
        </div>

        <div className="segment" role="group" aria-label="年代偏好">
          <button
            type="button"
            aria-pressed={windowed && eraBias === 'time'}
            disabled={deep}
            onClick={() => onEraBias('time')}
          >
            跨越各年代
          </button>
          <button
            type="button"
            aria-pressed={windowed && eraBias === 'volume'}
            disabled={deep}
            onClick={() => onEraBias('volume')}
          >
            偏向近几年
          </button>
        </div>

        {/*
         * Deep mode spends core on the id listing and search on hydration. Core
         * is the one that runs out — 60/hour against search's 600 — so it leads.
         */}
        <QuotaLine
          label={deep ? '仓库列表' : '搜索'}
          quota={deep ? quotas.core : quotas.search}
        />
        {deep && <QuotaLine label="补全信息" quota={quotas.search} />}

        {poolSize > 0 && (
          <span>
            手上还存着 {poolSize} 个，
            {deep ? '再抽只花一次搜索配额' : '再抽不花配额'}
          </span>
        )}
      </div>
    </section>
  )
}

function QuotaLine({ label, quota }: { label: string; quota: Quota | undefined }) {
  if (!quota) return <span>{label}配额还没查过</span>
  const left = quota.remaining === 0 ? secondsUntil(quota.resetAt) : 0
  return (
    <span>
      <QuotaTicks quota={quota} />
      {label}配额还剩 <b>{quota.remaining}</b> 次
      {quota.remaining === 0 && `，${waitLabel(left)}后恢复`}
    </span>
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
