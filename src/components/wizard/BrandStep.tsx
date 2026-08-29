import { useState } from 'react'
import type { BrandConfig } from '@/types/project'
import { readFileAsDataUrl } from '@/lib/files'
import { validateImageFile } from '@/lib/validation'

export default function BrandStep({ brand, onChange }: { brand: BrandConfig; onChange: (patch: Partial<BrandConfig>) => void }) {
  const [logoError, setLogoError] = useState<string | null>(null)

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
    onChange({ logoDataUrl: dataUrl })
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Brand</h2>
      <p className="hint" style={{ marginBottom: 20 }}>
        This appears on the customer landing page and can be woven into the QR code itself in the next step.
      </p>

      <div className="field">
        <label htmlFor="company-name">Company name</label>
        <input
          id="company-name"
          className="input"
          value={brand.companyName}
          maxLength={60}
          placeholder="e.g. AIS, ABC Interiors, XYZ Motors"
          onChange={(e) => onChange({ companyName: e.target.value })}
        />
      </div>

      <div className="field">
        <label htmlFor="tagline">Tagline (optional)</label>
        <input id="tagline" className="input" value={brand.tagline ?? ''} maxLength={80} onChange={(e) => onChange({ tagline: e.target.value })} />
      </div>

      <div className="field">
        <label htmlFor="logo-upload">Logo</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {brand.logoDataUrl ? (
            <img src={brand.logoDataUrl} alt="Company logo preview" style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--color-border)' }} />
          ) : null}
          <label className="btn btn-secondary" htmlFor="logo-upload" style={{ cursor: 'pointer' }}>
            {brand.logoDataUrl ? 'Replace logo' : 'Upload logo'}
          </label>
          <input id="logo-upload" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="visually-hidden" onChange={handleLogoUpload} />
          {brand.logoDataUrl ? (
            <button type="button" className="btn btn-ghost" onClick={() => onChange({ logoDataUrl: undefined })}>
              Remove
            </button>
          ) : null}
        </div>
        {logoError ? <span className="error">{logoError}</span> : <span className="hint">PNG, JPG, WEBP or SVG, up to 2MB.</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
        <ColorField id="primary-color" label="Primary colour" value={brand.primaryColor} onChange={(v) => onChange({ primaryColor: v })} />
        <ColorField id="secondary-color" label="Secondary colour" value={brand.secondaryColor} onChange={(v) => onChange({ secondaryColor: v })} />
        <ColorField id="background-color" label="Background" value={brand.backgroundColor} onChange={(v) => onChange({ backgroundColor: v })} />
      </div>
    </div>
  )
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 44, height: 44, padding: 2, border: '1px solid var(--color-border)', borderRadius: 8 }} />
        <input className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} hex value`} />
      </div>
    </div>
  )
}
