import { useEffect } from 'react'
import { useGameStore } from '../state/store.js'

const TOAST_MS = 3500

export default function Toast() {
  const notice = useGameStore((s) => s.notice)
  const clearNotice = useGameStore((s) => s.clearNotice)

  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(clearNotice, TOAST_MS)
    return () => clearTimeout(timer)
  }, [notice, clearNotice])

  if (!notice) return null
  return (
    <div className="toast" role="status" key={notice.id}>
      {notice.message}
    </div>
  )
}
