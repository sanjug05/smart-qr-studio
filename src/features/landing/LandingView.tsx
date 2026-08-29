import type { QRProject } from '@/types/project'
import { normalizeUrl, validateUrl } from '@/lib/validation'
import './LandingView.css'

export default function LandingView({ project }: { project: QRProject }) {
  const { brand } = project
  const destinations = [...project.destinations]
    .filter((d) => d.enabled && validateUrl(d.url).valid)
    .sort((a, b) => a.order - b.order)
    .slice(0, 5)

  return (
    <div
      className="landing"
      style={{
        // Only the background is brand-controlled; text colors stay fixed
        // so contrast is never at the mercy of an arbitrary brand palette.
        // (See design:accessibility-review guidance on contrast.)
        background: brand.backgroundColor || '#ffffff'
      }}
    >
      <div className="landing-card">
        {brand.logoDataUrl ? (
          <img src={brand.logoDataUrl} alt={`${brand.companyName || 'Company'} logo`} className="landing-logo" />
        ) : (
          <div className="landing-logo-fallback" style={{ background: brand.primaryColor }} aria-hidden="true">
            {(brand.companyName || 'Q').trim().charAt(0).toUpperCase()}
          </div>
        )}

        <h1 className="landing-title" style={{ color: brand.primaryColor }}>
          {brand.companyName || 'Smart QR'}
        </h1>

        {brand.tagline ? <p className="landing-tagline">{brand.tagline}</p> : null}

        <p className="landing-instruction">Choose what you'd like to explore</p>

        {destinations.length === 0 ? (
          <p className="landing-empty">No destinations are available right now.</p>
        ) : (
          <nav aria-label="Destinations" className="landing-destinations">
            {destinations.map((d) => (
              <a
                key={d.id}
                // Normalized, not the raw stored value: a destination saved
                // as "example.com" (no scheme) would otherwise resolve as a
                // relative link against this hash-routed page instead of an
                // absolute external URL.
                href={normalizeUrl(d.url)}
                className="landing-destination"
                style={{ borderColor: brand.secondaryColor }}
              >
                <span className="landing-destination-icon" aria-hidden="true">
                  {d.customIconDataUrl ? <img src={d.customIconDataUrl} alt="" /> : d.icon}
                </span>
                <span className="landing-destination-text">
                  <span className="landing-destination-label">{d.label}</span>
                  {d.description ? <span className="landing-destination-desc">{d.description}</span> : null}
                </span>
                <span className="landing-destination-chevron" aria-hidden="true">
                  ›
                </span>
              </a>
            ))}
          </nav>
        )}

        <p className="landing-footer">Powered by Smart QR Studio</p>
      </div>
    </div>
  )
}
