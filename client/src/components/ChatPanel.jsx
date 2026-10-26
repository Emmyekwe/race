import { useEffect, useRef, useState } from 'react'
import { request } from '../net/socket.js'
import { useGameStore } from '../state/store.js'

// Keep in sync with CHAT_MAX_LENGTH in server/server.js.
const CHAT_MAX_LENGTH = 200
const QUICK_CHAT = ['GG!', 'Good luck!', 'Nice race!', 'Rematch?', 'Ready?', 'Sorry!']
// While racing, the closed overlay only shows the tail of the conversation.
const RACE_PREVIEW_COUNT = 6

const isTypingTarget = (target) => target instanceof HTMLElement && target.closest('input, textarea, select')

function formatClock(at) {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Room chat. `lobby` is an always-open card; `race` is a HUD overlay that opens with
 * Enter or T, closes with Esc, and closes again after each message so driving resumes.
 */
export default function ChatPanel({ variant = 'lobby' }) {
  const inRace = variant === 'race'
  const chat = useGameStore((s) => s.chat)
  const selfUserId = useGameStore((s) => s.auth?.user?.id)
  const connected = useGameStore((s) => s.connection === 'connected')
  const [open, setOpen] = useState(!inRace)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)
  const logRef = useRef(null)

  const close = () => {
    setError(null)
    inputRef.current?.blur()
    if (inRace) setOpen(false)
  }

  useEffect(() => {
    if (!inRace) return undefined
    const onKeyDown = (event) => {
      if (isTypingTarget(event.target)) return
      if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'KeyT') {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inRace])

  useEffect(() => {
    if (open && inRace) inputRef.current?.focus()
  }, [open, inRace])

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [chat, open])

  const send = async (text, { fromDraft }) => {
    const clean = text.trim()
    if (!clean || sending) return
    setSending(true)
    setError(null)
    try {
      await request('chat:send', { text: clean })
      if (fromDraft) setDraft('')
      if (inRace) close()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const visible = inRace && !open ? chat.slice(-RACE_PREVIEW_COUNT) : chat

  return (
    <section className={`chat chat-${variant}${open ? ' is-open' : ''}`} aria-label="Room chat">
      {!inRace && <h2>Chat</h2>}

      <ol className="chat-log" ref={logRef} aria-live="polite">
        {!inRace && chat.length === 0 && <li className="chat-system">No messages yet — say hi!</li>}
        {visible.map((m) =>
          m.kind === 'system' ? (
            <li key={m.id} className="chat-line chat-system">
              {m.text}
            </li>
          ) : (
            <li key={m.id} className={`chat-line${m.userId === selfUserId ? ' mine' : ''}`}>
              {!inRace && <time className="chat-time">{formatClock(m.at)}</time>}
              <span className="dot" style={{ background: m.color ?? 'var(--muted)' }} />
              <span className="chat-name">{m.username}</span>
              <span className="chat-text">{m.text}</span>
            </li>
          ),
        )}
      </ol>

      {open ? (
        <>
          <form
            className="chat-form"
            onSubmit={(event) => {
              event.preventDefault()
              send(draft, { fromDraft: true })
            }}
          >
            <input
              ref={inputRef}
              value={draft}
              maxLength={CHAT_MAX_LENGTH}
              placeholder={inRace ? 'Message the room… (Esc to close)' : 'Message the room…'}
              aria-label="Chat message"
              disabled={!connected}
              onChange={(event) => {
                setDraft(event.target.value)
                setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  close()
                }
              }}
              // In a race, clicking back onto the track closes chat so the car responds again.
              onBlur={inRace ? () => setOpen(false) : undefined}
            />
            <button
              type="submit"
              className="btn small"
              disabled={!connected || sending || !draft.trim()}
              onMouseDown={(event) => event.preventDefault()}
            >
              Send
            </button>
          </form>
          <div className="chat-quick">
            {QUICK_CHAT.map((text) => (
              <button
                key={text}
                type="button"
                className="chip"
                disabled={!connected || sending}
                // Keep focus in the input so the race overlay doesn't close before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => send(text, { fromDraft: false })}
              >
                {text}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="chat-hint">
          <kbd>Enter</kbd> to chat
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  )
}
