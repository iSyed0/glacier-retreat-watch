import { useEffect, useRef, useState } from 'react'

// Floating chatbot (bottom-right). Talks to POST /api/chat, which runs a
// local LM Studio model and streams Server-Sent Events back:
//   status -> { stage: loading | reading | writing | looking_up, progress? }
//   reply  -> { say, actions, blocks, memory }
//   error  -> { message }
// Actions are handed to App.jsx via onActions; blocks (stats / tables /
// notes built from real data on the backend) are rendered here.

const SUGGESTIONS = [
  'How many glaciers in Pakistan are retreating?',
  'Show rivers and GLOF-II stations on the dark map',
  'Take me to the fastest-retreating glacier in Nepal',
  'Play the temperature timeline from 1999',
  'Compare Pakistan with the whole HKH region',
]

const STAGE_LABELS = {
  loading: 'Loading model…',
  reading: 'Reading your request…',
  writing: 'Thinking…',
  looking_up: 'Looking up data…',
}

const HISTORY_TURNS = 6

const LOGO_SRC = '/assistant-logo.png'

// Parse one SSE frame ("event: x\ndata: {...}") into [event, data].
function parseFrame(frame) {
  let event = 'message'
  let data = ''
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  try {
    return [event, JSON.parse(data)]
  } catch {
    return [event, null]
  }
}

function StatsBlock({ block }) {
  return (
    <div className="chat-block">
      {block.title && <div className="chat-block-title">{block.title}</div>}
      <div className="chat-stats">
        {block.items.map((it) => (
          <div key={it.label} className="chat-stat">
            <span className="k">{it.label}</span>
            <span className="v">{it.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TableBlock({ block, onOpenGlacier }) {
  const clickable = Array.isArray(block.features)
  return (
    <div className="chat-block">
      {block.title && <div className="chat-block-title">{block.title}</div>}
      <div className="chat-table-wrap">
        <table className="chat-table">
          <thead>
            <tr>{block.columns.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr
                key={i}
                className={clickable ? 'clickable' : ''}
                onClick={clickable ? () => onOpenGlacier(block.features[i]) : undefined}
                title={clickable ? 'Show on map' : undefined}
              >
                {row.map((cell, j) => <td key={j}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Message({ msg, onOpenGlacier }) {
  if (msg.role === 'user') return <div className="chat-msg user">{msg.text}</div>
  return (
    <div className={`chat-msg assistant${msg.error ? ' error' : ''}`}>
      {msg.text && <div className="chat-say">{msg.text}</div>}
      {(msg.blocks || []).map((b, i) => {
        if (b.type === 'stats') return <StatsBlock key={i} block={b} />
        if (b.type === 'table') return <TableBlock key={i} block={b} onOpenGlacier={onOpenGlacier} />
        return <div key={i} className={`chat-note ${b.tone || ''}`}>{b.text}</div>
      })}
    </div>
  )
}

// Default spot: left of Mapbox's bottom-right zoom/compass + zoom readout
// stack, and above the attribution line.
const DEFAULT_ANCHOR = { right: 96, bottom: 28 }
const ANCHOR_KEY = 'hkh-chat-anchor'
const DRAG_THRESHOLD_PX = 4

function loadAnchor() {
  try {
    const saved = JSON.parse(localStorage.getItem(ANCHOR_KEY))
    if (Number.isFinite(saved?.right) && Number.isFinite(saved?.bottom)) return saved
  } catch {
    // ignore -- private browsing / storage disabled / bad JSON
  }
  return DEFAULT_ANCHOR
}

// Drag support shared by the launcher and the open panel. Position is kept
// as an offset from the bottom-right corner (CSS right/bottom), so the
// panel opens growing up-and-left from wherever the launcher was left.
// A press that moves less than DRAG_THRESHOLD_PX counts as a click.
function useDragAnchor() {
  const [anchor, setAnchor] = useState(loadAnchor)
  const drag = useRef(null)

  // Re-render on window resize so the on-screen clamp below stays valid.
  const [, setViewport] = useState(0)
  useEffect(() => {
    const onResize = () => setViewport((n) => n + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const handlers = (onClick) => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return
      const rect = e.currentTarget.closest('[data-drag-root]').getBoundingClientRect()
      drag.current = { x: e.clientX, y: e.clientY, start: anchor, w: rect.width, h: rect.height, moved: false }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e) => {
      const d = drag.current
      if (!d) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return
      d.moved = true
      const topLimit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-height')) || 64
      setAnchor({
        right: Math.min(Math.max(d.start.right - dx, 0), window.innerWidth - d.w),
        bottom: Math.min(Math.max(d.start.bottom - dy, 0), window.innerHeight - topLimit - d.h),
      })
    },
    onPointerUp: (e) => {
      const d = drag.current
      drag.current = null
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      if (!d) return
      if (d.moved) {
        setAnchor((a) => {
          try {
            localStorage.setItem(ANCHOR_KEY, JSON.stringify(a))
          } catch {
            // ignore
          }
          return a
        })
      } else if (onClick) {
        onClick()
      }
    },
  })

  return { anchor, handlers }
}

export default function ChatPanel({ uiState, onActions, onOpenGlacier }) {
  const { anchor, handlers: dragHandlers } = useDragAnchor()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([]) // { role, text, memory?, blocks?, error? }
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(null) // { stage, progress } while a turn runs
  const [model, setModel] = useState({ state: 'checking' }) // /api/chat/status, or { state: 'offline', detail }
  const listRef = useRef(null)
  const abortRef = useRef(null)
  const inputRef = useRef(null)

  const checkStatus = () => {
    setModel({ state: 'checking' })
    fetch('/api/chat/status')
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.detail || `status check failed (${r.status})`)
        setModel(body)
      })
      .catch((err) => setModel({ state: 'offline', detail: err.message }))
  }

  const loadModel = () => {
    setModel((m) => ({ ...m, state: 'loading' }))
    fetch('/api/chat/model/load', { method: 'POST' })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.detail || `load failed (${r.status})`)
        checkStatus()
      })
      .catch((err) => setModel({ state: 'offline', detail: err.message }))
  }

  useEffect(() => {
    if (open && model.state === 'checking') checkStatus()
    if (open) inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, pending])

  const send = async (text) => {
    const message = text.trim()
    if (!message || pending) return
    const history = messages
      .slice(-HISTORY_TURNS)
      .map((m) => ({ role: m.role, text: m.role === 'user' ? m.text : m.memory || m.text }))
    setMessages((prev) => [...prev, { role: 'user', text: message }])
    setInput('')
    setPending({ stage: 'loading' })

    const controller = new AbortController()
    abortRef.current = controller
    let replied = false
    const addAssistant = (msg) => {
      replied = true
      setMessages((prev) => [...prev, { role: 'assistant', ...msg }])
    }

    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history, uiState }),
        signal: controller.signal,
      })
      if (!r.ok || !r.body) throw new Error(`request failed (${r.status})`)
      const reader = r.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const [event, data] = parseFrame(buf.slice(0, idx))
          buf = buf.slice(idx + 2)
          if (!data) continue
          if (event === 'status') {
            setPending({ stage: data.stage, progress: data.progress })
          } else if (event === 'reply') {
            addAssistant({ text: data.say, memory: data.memory, blocks: data.blocks })
            onActions(data.actions || [])
          } else if (event === 'error') {
            addAssistant({ text: data.message, error: true })
            checkStatus()
          }
        }
      }
      if (!replied) addAssistant({ text: 'No reply from the model.', error: true })
    } catch (err) {
      if (err.name === 'AbortError') addAssistant({ text: 'Stopped.', error: true })
      else addAssistant({ text: `Couldn't reach the assistant: ${err.message}`, error: true })
    } finally {
      abortRef.current = null
      setPending(null)
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  if (!open) {
    return (
      <button
        id="chat-launcher"
        type="button"
        data-drag-root
        style={{ right: anchor.right, bottom: anchor.bottom }}
        {...dragHandlers(() => setOpen(true))}
        // Pointer clicks open via the drag handler (so a drag doesn't also
        // open it); keyboard Enter/Space arrives here with detail === 0.
        onClick={(e) => { if (e.detail === 0) setOpen(true) }}
        title="Ask the portal assistant (drag to move)"
        aria-label="Open portal assistant"
      >
        <img src={LOGO_SRC} alt="" draggable={false} />
      </button>
    )
  }

  const modelLabel = model.displayName || model.model || 'Local model'
  const ready = model.state === 'ready'

  // The panel is far bigger than the launcher, so keep it fully on screen
  // when it opens near an edge (mirrors the CSS width/height formulas).
  const barHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-height')) || 64
  const panelW = Math.min(400, window.innerWidth - 32)
  const panelH = Math.min(600, window.innerHeight - barHeight - 32)
  const panelStyle = {
    right: Math.max(8, Math.min(anchor.right, window.innerWidth - panelW - 8)),
    bottom: Math.max(8, Math.min(anchor.bottom, window.innerHeight - barHeight - panelH - 8)),
  }

  return (
    <div id="chat-panel" role="dialog" aria-label="Portal assistant" data-drag-root style={panelStyle}>
      <div className="chat-header" {...dragHandlers()} title="Drag to move">
        <img className="chat-avatar" src={LOGO_SRC} alt="" draggable={false} />
        <div className="chat-header-text">
          <div className="chat-title">Portal Assistant</div>
          <div className="chat-sub">
            <span className={`chat-dot ${ready ? 'ok' : model.state === 'offline' || model.state === 'missing' ? 'bad' : 'wait'}`} />
            {modelLabel} · local (LM Studio)
          </div>
        </div>
        <div className="chat-header-actions">
          {messages.length > 0 && (
            <button type="button" className="chat-icon-btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => setMessages([])} title="Clear conversation" disabled={!!pending}>
              ⟲
            </button>
          )}
          <button type="button" className="chat-icon-btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen(false)} title="Close">✕</button>
        </div>
      </div>

      {model.state === 'offline' && (
        <div className="chat-banner bad">
          {model.detail || 'LM Studio is not reachable.'}
          <button type="button" onClick={checkStatus}>Retry</button>
        </div>
      )}
      {model.state === 'missing' && (
        <div className="chat-banner bad">Model {model.model} isn't downloaded in LM Studio.</div>
      )}
      {model.state === 'not_loaded' && (
        <div className="chat-banner wait">
          Model isn't loaded (needs {model.minContext} context).
          <button type="button" onClick={loadModel}>Load now</button>
        </div>
      )}
      {model.state === 'loading' && <div className="chat-banner wait">Loading model in LM Studio…</div>}

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <img className="chat-empty-logo" src={LOGO_SRC} alt="" />
            <p>Ask about glaciers and trends, or tell me what to show on the map.</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} disabled={!!pending}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => <Message key={i} msg={m} onOpenGlacier={onOpenGlacier} />)}
        {pending && (
          <div className="chat-msg assistant pending">
            <div className="chat-pending-label">{STAGE_LABELS[pending.stage] || 'Working…'}</div>
            <div className="chat-progress">
              <div
                className={pending.progress == null ? 'indeterminate' : ''}
                style={pending.progress != null ? { width: `${Math.round(pending.progress * 100)}%` } : undefined}
              />
            </div>
          </div>
        )}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask or give a command…"
          maxLength={1000}
        />
        {pending ? (
          <button type="button" onClick={() => abortRef.current?.abort()} title="Stop">■</button>
        ) : (
          <button type="submit" disabled={!input.trim()} title="Send">➤</button>
        )}
      </form>
    </div>
  )
}
