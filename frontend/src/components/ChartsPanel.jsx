import { useRef, useState } from 'react'

function Chevron({ open }) {
  return (
    <svg
      className={`chevron${open ? ' open' : ''}`}
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function ChartRowIcon({ variant }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', width: 16, height: 16 }
  if (variant === 'specificMass') return <svg {...common}><path d="M12 3v11" /><polyline points="8 10 12 14 16 10" /><rect x="4" y="17" width="16" height="4" rx="1" /></svg>
  return <svg {...common}><polyline points="3 17 9 11 13 15 21 6" /><polyline points="15 6 21 6 21 12" /></svg>
}

function StatusDot({ status }) {
  return <span className={`chart-row-status${status === 'error' ? ' error' : ''}${status === 'loading' ? ' loading' : ''}`} />
}

function ChartRow({ variant, title, region, status, onClick }) {
  return (
    <button type="button" className="chart-row" onClick={onClick}>
      <span className="chart-row-icon"><ChartRowIcon variant={variant} /></span>
      <span className="chart-row-text">
        <span className="chart-row-title">{title}</span>
        <span className="chart-row-region">{region}</span>
      </span>
      <StatusDot status={status} />
    </button>
  )
}

// Floating, draggable launcher for all four trend charts -- lists them so
// opening one doesn't require topbar buttons to keep multiplying as more
// chart variants/regions get added (see App.jsx for the actual panels).
// Always on screen (like the Glacier Status legend) -- collapse, don't
// close, since there's no topbar button to bring it back.
export default function ChartsPanel({ charts }) {
  const panelRef = useRef(null)
  const dragOffset = useRef({ x: 0, y: 0 })
  const [pos, setPos] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('hkh-charts-collapsed') === '1'
    } catch {
      return false
    }
  })

  const setCollapsedPersist = (next) => {
    setCollapsed(next)
    try {
      localStorage.setItem('hkh-charts-collapsed', next ? '1' : '0')
    } catch {
      // ignore -- private browsing / storage disabled
    }
  }

  const clamp = (left, top) => {
    const panel = panelRef.current
    const margin = 24
    if (!panel) return { left, top }
    const { width } = panel.getBoundingClientRect()
    return {
      left: Math.min(Math.max(left, margin - width), window.innerWidth - margin),
      top: Math.min(Math.max(top, 0), window.innerHeight - margin),
    }
  }

  const handlePointerDown = (e) => {
    const panel = panelRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    setPos({ left: rect.left, top: rect.top })
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e) => {
    if (!dragging) return
    setPos(clamp(e.clientX - dragOffset.current.x, e.clientY - dragOffset.current.y))
  }

  const handlePointerUp = (e) => {
    setDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const panelStyle = pos ? { left: pos.left, top: pos.top, right: 'auto' } : undefined

  return (
    <div id="charts-panel" className={collapsed ? 'collapsed' : ''} ref={panelRef} style={panelStyle}>
      <div
        className="charts-panel-header"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        title="Drag to move"
      >
        <span className="charts-panel-title">Charts</span>
        <span className="charts-panel-actions">
          <button
            type="button"
            className="legend-icon-btn"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setCollapsedPersist(!collapsed)}
            aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <Chevron open={!collapsed} />
          </button>
        </span>
      </div>

      {!collapsed && (
        <div className="charts-panel-body">
          {charts.map((c) => (
            <ChartRow key={c.key} {...c} />
          ))}
        </div>
      )}
    </div>
  )
}
