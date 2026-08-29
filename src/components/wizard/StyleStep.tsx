import { useState } from 'react'
import type { BrandingStyle, ModuleStyle, QRStyleConfig } from '@/types/project'
import { readFileAsDataUrl } from '@/lib/files'
import { validateImageFile } from '@/lib/validation'

const MODULE_STYLES: Array<{ value: ModuleStyle; label: string }> = [
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'dots', label: 'Dots / circles' }
]

const BRANDING_STYLES: Array<{ value: BrandingStyle; label: string; hint: string }> = [
  { value: 'none', label: 'None', hint: 'Plain QR, maximum reliability.' },
  { value: 'logo', label: 'Logo', hint: 'Uses your uploaded logo.' },
  { value: 'initials', label: 'Company initials', hint: 'Derived automatically from the company name.' },
  { value: 'name', label: 'Company name', hint: 'Full name if short enough, otherwise falls back to initials.' },
  { value: 'custom', label: 'Custom', hint: 'Upload a dedicated branding image, or enter custom text.' }
]

export default function StyleStep({
  qrStyle,
  companyName,
  onChange
}: {
  qrStyle: QRStyleConfig
  companyName: string
  onChange: (patch: Partial<QRStyleConfig>) => void
}) {
  const [logoError, setLogoError] = useState<string | null>(null)

  const handleBrandingLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const validation = validateImageFile(file)
    if (!validation.valid) {
      setLogoError(validation.message ?? 'Invalid image.')
      return
    }
    setLogoError(null)
    const dataUrl = await readFileAsDataUrl(file)
    onChange({ brandingLogoDataUrl: dataUrl })
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>QR Style</h2>

      <div className="field">
        <label>Module style</label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {MODULE_STYLES.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`btn ${qrStyle.moduleStyle === opt.value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => onChange({ moduleStyle: opt.value })}
              aria-pressed={qrStyle.moduleStyle === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <RangeField id="qr-size" label={`Size (${qrStyle.size}px)`} min={240} max={1024} step={8} value={qrStyle.size} onChange={(v) => onChange({ size: v })} />
        <RangeField id="qr-quiet-zone" label={`Quiet zone (${qrStyle.quietZone}px)`} min={0} max={48} step={2} value={qrStyle.quietZone} onChange={(v) => onChange({ quietZone: v })} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginTop: 4 }}>
        <ColorField id="qr-fg" label="Foreground" value={qrStyle.foregroundColor} onChange={(v) => onChange({ foregroundColor: v })} />
        <ColorField id="qr-bg" label="Background" value={qrStyle.backgroundColor} onChange={(v) => onChange({ backgroundColor: v })} disabled={qrStyle.transparentBackground} />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 24px', fontWeight: 600, fontSize: '0.9rem' }}>
        <input type="checkbox" checked={qrStyle.transparentBackground} onChange={(e) => onChange({ transparentBackground: e.target.checked })} />
        Transparent background (PNG export only)
      </label>

      <h3 style={{ marginBottom: 4 }}>QR Branding</h3>
      <p className="hint" style={{ marginTop: 0, marginBottom: 16 }}>
        The company identity is rendered as a small, centered image and protected by high error correction — never
        by reshaping the code's own data modules. Scan reliability is verified automatically after generation.
      </p>

      <div className="field">
        <label>Branding style</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {BRANDING_STYLES.map((opt) => (
            <label key={opt.value} className="card" style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="radio" name="branding-style" checked={qrStyle.brandingStyle === opt.value} onChange={() => onChange({ brandingStyle: opt.value })} style={{ marginTop: 4 }} />
              <span>
                <span style={{ fontWeight: 700, display: 'block' }}>{opt.label}</span>
                <span className="hint">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {qrStyle.brandingStyle === 'logo' || qrStyle.brandingStyle === 'custom' ? (
        <div className="field">
          <label htmlFor="branding-logo">Branding image</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {qrStyle.brandingLogoDataUrl ? (
              <img src={qrStyle.brandingLogoDataUrl} alt="Branding image preview" style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--color-border)' }} />
            ) : null}
            <label className="btn btn-secondary" htmlFor="branding-logo" style={{ cursor: 'pointer' }}>
              Upload image
            </label>
            <input id="branding-logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="visually-hidden" onChange={handleBrandingLogoUpload} />
          </div>
          {logoError ? <span className="error">{logoError}</span> : null}
          {qrStyle.brandingStyle === 'custom' && !qrStyle.brandingLogoDataUrl ? (
            <span className="hint">No image uploaded — the company name ({companyName || '—'}) will be used as text instead.</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function RangeField({ id, label, min, max, step, value, onChange }: { id: string; label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ minHeight: 44 }} />
    </div>
  )
}

function ColorField({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: disabled ? 0.5 : 1 }}>
        <input id={id} type="color" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 44, height: 44, padding: 2, border: '1px solid var(--color-border)', borderRadius: 8 }} />
        <input className="input" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} hex value`} />
      </div>
    </div>
  )
}
