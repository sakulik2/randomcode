import { useState } from 'react'

/**
 * Optional token. Lives in localStorage only — never in the repo, the build, or
 * a log. Unauthenticated search allows 10 requests/min; a token raises it to 30.
 */
export function TokenField({
  token,
  onSave,
}: {
  token: string
  onSave: (token: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)

  if (token && !open) {
    return (
      <span className="tokenbar__row">
        <span className="quota">已在用你的 token，配额 30 次/分钟</span>
        <button className="linkish" onClick={() => onSave('')}>
          清掉 token
        </button>
      </span>
    )
  }

  if (!open) {
    return (
      <button className="linkish" onClick={() => setOpen(true)}>
        加个 token，把配额提到 30 次/分钟
      </button>
    )
  }

  return (
    <form
      className="tokenbar"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(draft)
        setDraft('')
        setOpen(false)
      }}
    >
      <span className="tokenbar__row">
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="ghp_… 或 github_pat_…"
          aria-label="GitHub token"
          autoComplete="off"
          spellCheck={false}
        />
        <button className="linkish" type="submit">
          保存
        </button>
        <button className="linkish" type="button" onClick={() => setOpen(false)}>
          取消
        </button>
      </span>
      <p className="tokenbar__note">
        只存在这台浏览器的 localStorage 里，不会发到别处。免 token 也能用，只是每分钟 10 次。
        建了 token 不用勾任何权限，公开仓库搜索不需要。
      </p>
    </form>
  )
}
