import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../net/api.js'
import { request } from '../net/socket.js'
import { useGameStore } from '../state/store.js'
import { accelerationFactor, GARAGE } from '../game/constants.js'

const AUTOSAVE_DELAY_MS = 600

const STATUS_LABEL = {
  idle: '',
  pending: 'Unsaved changes…',
  saving: 'Saving…',
  saved: 'Saved ✓',
}

function CarPreview({ color, accentColor }) {
  return (
    <svg className="car-preview" viewBox="0 0 120 64" aria-hidden="true">
      <rect x="18" y="6" width="14" height="12" rx="3" fill="#111" />
      <rect x="88" y="6" width="14" height="12" rx="3" fill="#111" />
      <rect x="18" y="46" width="14" height="12" rx="3" fill="#111" />
      <rect x="88" y="46" width="14" height="12" rx="3" fill="#111" />
      <rect x="8" y="12" width="104" height="40" rx="12" fill={color} />
      <rect x="40" y="18" width="34" height="28" rx="6" fill="#0f172a" />
      <rect x="78" y="28" width="30" height="8" rx="2" fill={accentColor} />
      <rect x="2" y="14" width="8" height="36" rx="2" fill={accentColor} />
    </svg>
  )
}

function ColorPicker({ label, value, onChange }) {
  return (
    <fieldset className="color-picker">
      <legend>{label}</legend>
      <div className="swatches">
        {GARAGE.swatches.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={`swatch ${swatch === value ? 'selected' : ''}`}
            style={{ background: swatch }}
            onClick={() => onChange(swatch)}
            aria-label={`${label} ${swatch}`}
            aria-pressed={swatch === value}
          />
        ))}
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          aria-label={`Custom ${label.toLowerCase()}`}
        />
      </div>
    </fieldset>
  )
}

/**
 * Car customisation backed by MongoDB. Changes auto-save; when you're in a lobby
 * they're pushed to the room so everyone sees your new paint before the race.
 */
export default function GarageUI() {
  const token = useGameStore((s) => s.auth.token)
  const garage = useGameStore((s) => s.garage)
  const setGarage = useGameStore((s) => s.setGarage)
  const logout = useGameStore((s) => s.logout)

  const [draft, setDraft] = useState(garage)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const timer = useRef(null)
  const latestDraft = useRef(draft)
  latestDraft.current = draft

  useEffect(() => {
    if (garage) return undefined
    let cancelled = false
    api
      .getGarage(token)
      .then(({ garage: loaded }) => !cancelled && setGarage(loaded))
      .catch((err) => {
        if (err.status === 401) logout()
        else if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [garage, token, setGarage, logout])

  // Seed the editor once the saved garage arrives; never overwrite edits in progress.
  useEffect(() => {
    if (garage && !latestDraft.current) setDraft(garage)
  }, [garage])

  const save = useCallback(async () => {
    timer.current = null
    const values = latestDraft.current
    if (!values) return
    setStatus('saving')
    try {
      const { garage: saved } = await api.updateGarage(token, {
        selectedCarColor: values.selectedCarColor,
        accentColor: values.accentColor,
        topSpeedModifier: values.topSpeedModifier,
      })
      setGarage(saved)
      if (useGameStore.getState().room?.status === 'lobby') {
        await request('garage:refresh').catch(() => {})
      }
      setStatus('saved')
    } catch (err) {
      if (err.status === 401) logout()
      setStatus('error')
      setError(err.message)
    }
  }, [token, setGarage, logout])

  // If the component unmounts mid-debounce (e.g. you join a room), save immediately.
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        saveRef.current()
      }
    },
    [],
  )

  const update = (patch) => {
    setDraft((current) => ({ ...current, ...patch }))
    setStatus('pending')
    setError(null)
    clearTimeout(timer.current)
    timer.current = setTimeout(save, AUTOSAVE_DELAY_MS)
  }

  if (!draft) {
    return (
      <section className="card">
        <h2>Garage</h2>
        {error ? <p className="error">{error}</p> : <p className="muted">Loading garage…</p>}
      </section>
    )
  }

  return (
    <section className="card garage">
      <div className="card-title-row">
        <h2>Garage</h2>
        <span className={`save-status ${status}`} role="status">
          {status === 'error' ? 'Not saved' : STATUS_LABEL[status]}
        </span>
      </div>

      <CarPreview color={draft.selectedCarColor} accentColor={draft.accentColor} />

      <ColorPicker
        label="Body colour"
        value={draft.selectedCarColor}
        onChange={(selectedCarColor) => update({ selectedCarColor })}
      />
      <ColorPicker label="Accent colour" value={draft.accentColor} onChange={(accentColor) => update({ accentColor })} />

      <label className="slider">
        <span>
          Top speed modifier <strong>×{draft.topSpeedModifier.toFixed(2)}</strong>
        </span>
        <input
          type="range"
          min={GARAGE.minSpeedModifier}
          max={GARAGE.maxSpeedModifier}
          step={0.05}
          value={draft.topSpeedModifier}
          onChange={(e) => update({ topSpeedModifier: Math.round(Number(e.target.value) * 100) / 100 })}
        />
        <span className="muted small">
          Top speed ×{draft.topSpeedModifier.toFixed(2)} · Acceleration ×
          {accelerationFactor(draft.topSpeedModifier).toFixed(2)}
        </span>
      </label>

      {error && <p className="error">{error}</p>}
    </section>
  )
}
