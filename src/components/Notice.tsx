import { useEffect, useState } from 'react'
import type { Failure } from '../lib/types.ts'

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
    detail =
      left > 0
        ? `${failure.message}，${left} 秒后恢复。加个 token 能提到 30 次/分钟。`
        : '配额已经恢复了，再抽一次就行。'
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
