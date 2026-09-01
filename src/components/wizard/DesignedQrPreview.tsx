import { useEffect, useState } from 'react'
import type QRCodeStyling from 'qr-code-styling'
import type { BrandConfig, QrDesignConfig } from '@/types/project'
import { getSvgMarkup } from '@/services/qr/qrExport'
import { buildDesignedQrSvg } from '@/services/qr/designComposition'
import './DesignedQrPreview.css'

type DesignBrand = Pick<BrandConfig, 'companyName' | 'tagline' | 'logoDataUrl' | 'primaryColor' | 'secondaryColor'>

/**
 * Live preview of exactly what "Download Designed QR" will produce.
 * Rendered as an `<img>` from a data: URI — never `dangerouslySetInnerHTML`
 * — so even though every piece of user text in the composition is already
 * escaped at build time (see designComposition.ts), the browser's image
 * decoder is a second, independent boundary: an `<img>` never executes
 * scripts or interactive content from SVG source, unlike inlining the
 * markup into the DOM would.
 */
export default function DesignedQrPreview({
  instance,
  brand,
  designConfig
}: {
  instance: QRCodeStyling | null
  brand: DesignBrand
  designConfig: QrDesignConfig
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!instance) {
      setDataUrl(null)
      return
    }
    getSvgMarkup(instance)
      .then((markup) => {
        if (cancelled) return
        const svg = buildDesignedQrSvg({ brand, designConfig, qrSvgMarkup: markup })
        setDataUrl(`data:image/svg+xml,${encodeURIComponent(svg)}`)
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, JSON.stringify(brand), JSON.stringify(designConfig)])

  if (!dataUrl) {
    return (
      <div className="designed-qr-preview-placeholder" role="status">
        Rendering designed preview…
      </div>
    )
  }

  return (
    <img
      src={dataUrl}
      alt={`Designed QR composition for ${brand.companyName || 'this project'} — logo, headline, QR code, and scan instruction`}
      className="designed-qr-preview-image"
    />
  )
}
