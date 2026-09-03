import { useCallback, useEffect, useState } from 'react'
import type { DynamicQrInfo, QRProject } from '@/types/project'
import { toLandingContent } from '@/types/project'
import { validateUrl } from '@/lib/validation'
import { dynamicQrService } from '@/services/dynamicQr'
import { useEntitlement } from './useEntitlement'

export interface UseDynamicQrState {
  /** True while the initial create() call is in flight — see qrCodeFactory.ts's DynamicQrNotProvisionedError. */
  provisioning: boolean
  /** True while an explicit "Publish changes" call is in flight. */
  publishing: boolean
  error: string | null
  publishedVersion: number | null
  /** Re-sends the project's current brand/destinations as the QR's published content. No-op if not yet provisioned. */
  publish: () => Promise<void>
}

/**
 * Owns the one-time "create this project's Dynamic QR" call and the
 * explicit "publish changes" action. Both go through `dynamicQrService`
 * only — this hook never touches localStorage, a management token, or
 * `fetch` directly (see dynamicQrAuthorizationService.ts).
 */
export function useDynamicQr(project: QRProject, onCreated: (info: DynamicQrInfo) => void): UseDynamicQrState {
  const [provisioning, setProvisioning] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null)

  const { allowed } = useEntitlement('dynamicQr')
  const hasValidDestination = project.destinations.some((d) => d.enabled && validateUrl(d.url).valid)
  const publicId = project.dynamicQr?.publicId

  useEffect(() => {
    if (project.qrMode !== 'dynamic' || publicId || !hasValidDestination) return
    if (!allowed) {
      setError('Dynamic QR is not available on your current plan.')
      return
    }

    let cancelled = false
    setProvisioning(true)
    setError(null)

    dynamicQrService
      .create(toLandingContent(project))
      .then((result) => {
        if (cancelled) return
        setPublishedVersion(result.version)
        onCreated({ publicId: result.publicId, createdAt: new Date().toISOString() })
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not create the Dynamic QR.')
      })
      .finally(() => {
        if (!cancelled) setProvisioning(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.qrMode, publicId, hasValidDestination, allowed])

  const publish = useCallback(async () => {
    if (!publicId) return
    setPublishing(true)
    setError(null)
    const result = await dynamicQrService.update(publicId, toLandingContent(project))
    setPublishing(false)
    if (result.ok) {
      setPublishedVersion(result.version ?? null)
    } else {
      setError(result.error ?? 'Could not publish changes.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicId, JSON.stringify(project.brand), JSON.stringify(project.destinations)])

  return { provisioning, publishing, error, publishedVersion, publish }
}
