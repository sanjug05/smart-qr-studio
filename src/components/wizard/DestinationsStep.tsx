import { useRef, useState } from 'react'
import type { Destination } from '@/types/project'
import { validateUrl } from '@/lib/validation'
import './DestinationsStep.css'

const ICON_CHOICES = ['🌐', '📍', '📖', '🏠', '📞', '🛍️', '📅', '🎟️', '💬', '📷', '⭐', '🔗']

export default function DestinationsStep({
  destinations,
  onChange
}: {
  destinations: Destination[]
  onChange: (destinations: Destination[]) => void
}) {
  const dragIndex = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const sorted = [...destinations].sort((a, b) => a.order - b.order)

  function update(id: string, patch: Partial<Destination>) {
    onChange(destinations.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  function reorder(fromIndex: number, toIndex: number) {
    const next = [...sorted]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    onChange(next.map((d, i) => ({ ...d, order: i })))
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Destinations</h2>
      <p className="hint" style={{ marginBottom: 20 }}>
        Up to five destinations appear on the customer landing page, in this order. Drag the handle to reorder;
        disable any you don't need.
      </p>

      <div className="destination-list">
        {sorted.map((destination, index) => {
          const validation = destination.enabled ? validateUrl(destination.url) : { valid: true }
          return (
            <div
              key={destination.id}
              className={`destination-editor${dragOverIndex === index ? ' drag-over' : ''}`}
              draggable
              onDragStart={() => (dragIndex.current = index)}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOverIndex(index)
              }}
              onDragLeave={() => setDragOverIndex((i) => (i === index ? null : i))}
              onDrop={(e) => {
                e.preventDefault()
                if (dragIndex.current !== null && dragIndex.current !== index) reorder(dragIndex.current, index)
                dragIndex.current = null
                setDragOverIndex(null)
              }}
            >
              <div className="destination-editor-header">
                <span className="drag-handle" aria-hidden="true" title="Drag to reorder">
                  ⠿
                </span>
                <span className="destination-index">Destination {index + 1}</span>
                <label className="destination-toggle">
                  <input type="checkbox" checked={destination.enabled} onChange={(e) => update(destination.id, { enabled: e.target.checked })} />
                  Enabled
                </label>
              </div>

              <div className="destination-editor-grid">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`icon-${destination.id}`}>Icon</label>
                  <select
                    id={`icon-${destination.id}`}
                    className="select"
                    value={destination.icon}
                    onChange={(e) => update(destination.id, { icon: e.target.value })}
                  >
                    {ICON_CHOICES.map((icon) => (
                      <option key={icon} value={icon}>
                        {icon}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`label-${destination.id}`}>Label</label>
                  <input
                    id={`label-${destination.id}`}
                    className="input"
                    value={destination.label}
                    maxLength={30}
                    onChange={(e) => update(destination.id, { label: e.target.value })}
                  />
                </div>
              </div>

              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor={`url-${destination.id}`}>URL</label>
                <input
                  id={`url-${destination.id}`}
                  className="input"
                  value={destination.url}
                  placeholder="https://…"
                  onChange={(e) => update(destination.id, { url: e.target.value })}
                />
                {!validation.valid ? <span className="error">{validation.message}</span> : null}
              </div>

              <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
                <label htmlFor={`desc-${destination.id}`}>Description (optional)</label>
                <input
                  id={`desc-${destination.id}`}
                  className="input"
                  value={destination.description ?? ''}
                  maxLength={60}
                  onChange={(e) => update(destination.id, { description: e.target.value })}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
