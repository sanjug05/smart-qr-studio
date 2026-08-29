import { useEffect, useRef, useState } from 'react'
import type QRCodeStyling from 'qr-code-styling'
import type { QRProject } from '@/types/project'
import { generateVerifiedQr } from '@/services/qr/generateVerifiedQr'

export interface UseVerifiedQrState {
  containerRef: React.RefObject<HTMLDivElement>
  instance: QRCodeStyling | null
  verified: boolean
  fallbackApplied: boolean
  message?: string
  loading: boolean
  landingUrl: string
}

/**
 * Live QR preview: rebuilds and re-verifies the code whenever the project
 * changes, and mounts it into containerRef. Debounced slightly so rapid
 * slider/color changes in the style panel don't trigger a decode pass per
 * keystroke.
 */
export function useVerifiedQr(project: QRProject): UseVerifiedQrState {
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<QRCodeStyling | null>(null)
  const [state, setState] = useState<Omit<UseVerifiedQrState, 'containerRef' | 'instance'>>({
    verified: false,
    fallbackApplied: false,
    loading: true,
    landingUrl: ''
  })

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))

    const timer = window.setTimeout(async () => {
      const { result, verified, fallbackApplied, message } = await generateVerifiedQr(project)
      if (cancelled) return

      instanceRef.current = result.instance
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
        result.instance.append(containerRef.current)
      }

      setState({ verified, fallbackApplied, message, loading: false, landingUrl: result.data })
    }, 200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // Re-run whenever anything about the project that affects QR rendering changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(project.brand), JSON.stringify(project.qrStyle), project.slug])

  return { containerRef, instance: instanceRef.current, ...state }
}
