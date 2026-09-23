import { useEffect, useState } from 'react'
import type { Failure } from '../lib/types.ts'

/** A core-bucket wait runs to the hour, so seconds alone stop being readable. */
function waitLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins} 分钟`
  return `${Math.floor(mins / 60)} 小时 ${mins % 60} 分钟`
}

/**
 * Failures give direction, not mood. A quota wall says how long the wait is and
 * what shortens it; it doesn't apologize or tell anyone to try again later.
 */
export function Notice({ failure }: { failure: Failure }) {
  const [, tick] = useState(0)

  // Count the quota timer down live so the number stays true.
  useEffect(() => {
    if (failure.kind !== 'quota') return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [failure.kind])

  const heading =
    failure.kind === 'quota'
      ? '配额用完了'
      : failure.kind === 'empty'
        ? '这个时间窗是空的'
        : failure.kind === 'unauthorized'
          ? 'token 没通过'
          : failure.kind === 'network'
            ? '连不上 GitHub'
            : '出了个意外情况'

  let detail = failure.message
  if (failure.kind === 'quota' && failure.resetAt) {
    const left = Math.max(0, failure.resetAt - Math.floor(Date.now() / 1000))
    /*
     * The two buckets refill on different clocks and a token lifts them by
     * different amounts, so the wait has to name the right one. Core is what deep
     * water runs out of, and an hour-long wait can't be quoted in seconds.
     */
    const lift =
      failure.resource === 'core'
        ? '加个 token 能把仓库列表提到 5000 次/小时。'
        : '加个 token 能提到 30 次/分钟。'
    detail = left > 0 ? `${failure.message}，${waitLabel(left)}后恢复。${lift}` : '配额已经恢复了，再抽一次就行。'
  }

  return (
    <section className="notice" data-kind={failure.kind} role="status">
      <h2>{heading}</h2>
      <p>{detail}</p>
    </section>
  )
}

/** An empty screen is an invitation to act. */
export function EmptyState() {
  return (
    <section className="empty">
      <h2>还没抽过</h2>
      <p>
        点「抽一批」开始。想看更野的东西就把星数门槛往左拉。
      </p>
    </section>
  )
}
