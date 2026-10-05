import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useProjectDraft } from '@/hooks/useProjectDraft'
import { useCloudSave } from '@/hooks/useCloudSave'
import { useAuth } from '@/hooks/useAuth'
import StepIndicator from '@/components/wizard/StepIndicator'
import QrTypeStep from '@/components/wizard/QrTypeStep'
import BrandStep from '@/components/wizard/BrandStep'
import DestinationsStep from '@/components/wizard/DestinationsStep'
import StyleStep from '@/components/wizard/StyleStep'
import PreviewStep from '@/components/wizard/PreviewStep'
import QRPreviewPanel from '@/components/wizard/QRPreviewPanel'
import './CreateQR.css'

const TOTAL_STEPS = 5

export default function CreateQR() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { project, ready, saveError, applyCloudSync, replaceProject, updateBrand, updateDestinations, updateQrStyle, updateDesignConfig, updateQrMode, setDynamicQrInfo } =
    useProjectDraft(id)
  const cloud = useCloudSave(project, applyCloudSync, replaceProject)
  const { status: authStatus } = useAuth()
  const [step, setStep] = useState(1)

  // react-router keeps this component instance mounted across /create <->
  // /create/:id transitions (same element at the same tree position), so
  // wizard step state must be reset explicitly whenever the target project
  // changes — otherwise "Create New QR" from step 4 of a previous project
  // opens straight into the preview step of a blank one.
  useEffect(() => {
    setStep(1)
  }, [id])

  if (!ready || !project) {
    return <p>Loading…</p>
  }

  const hasValidDestination = project.destinations.some((d) => d.enabled && d.url.trim())
  const canAdvanceFromDestinations = step !== 3 || hasValidDestination

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Create Smart QR</h1>
        <button
          className="btn btn-ghost"
          disabled={cloud.saving}
          onClick={async () => {
            // Signed in: make sure the cloud copy is current before leaving; stay put (with the reason) if it can't be.
            if (await cloud.save()) navigate('/codes')
          }}
        >
          {cloud.saving ? 'Saving…' : 'Save & exit'}
        </button>
      </div>

      <StepIndicator step={step} />

      {cloud.signedIn ? (
        <div className="card" style={{ padding: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }} role="status" aria-live="polite">
          <span style={{ flex: 1, minWidth: 200, fontSize: '0.9rem' }}>
            {cloud.saveStatus === 'saved'
              ? `Saved to your account (version ${project.cloud?.version}).`
              : cloud.saveStatus === 'unsaved'
                ? 'You have changes that aren’t saved to your account yet.'
                : 'Not saved to your account yet.'}
          </span>
          <button className="btn btn-secondary" disabled={cloud.saving || cloud.saveStatus === 'saved' || cloud.dynamicPending} onClick={() => void cloud.save()}>
            {cloud.saving ? 'Saving…' : 'Save to my account'}
          </button>
        </div>
      ) : authStatus === 'signedOut' ? (
        <p className="hint" style={{ marginTop: 0 }}>
          This QR code is saved on this device only. Sign in with Google above to save it to your account and open it on other devices.
        </p>
      ) : null}

      {cloud.error ? (
        <p className="error card" role="alert" style={{ padding: 12, marginBottom: 16 }}>
          {cloud.error}
        </p>
      ) : null}

      {cloud.conflict ? (
        <div className="card" role="alert" style={{ padding: 16, marginBottom: 16 }}>
          <strong>A newer version of this QR code was saved from another device.</strong>
          <p style={{ margin: '8px 0 12px' }}>Choose which one to keep. Your edits on this device are not lost until you choose.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => void cloud.useCloudVersion()}>
              Use the newer version (discard my edits)
            </button>
            <button className="btn btn-secondary" onClick={() => void cloud.overwriteCloud()}>
              Keep my version (overwrite the newer one)
            </button>
            <button className="btn btn-ghost" onClick={cloud.dismissConflict}>
              Decide later
            </button>
          </div>
        </div>
      ) : null}

      {saveError ? (
        <p className="error card" role="alert" style={{ padding: 12, marginBottom: 16 }}>
          {saveError}
        </p>
      ) : null}

      <div className="create-qr-layout">
        <div className="card create-qr-form">
          {step === 1 ? <QrTypeStep qrMode={project.qrMode ?? 'static'} onChange={updateQrMode} /> : null}
          {step === 2 ? <BrandStep brand={project.brand} onChange={updateBrand} /> : null}
          {step === 3 ? <DestinationsStep destinations={project.destinations} onChange={updateDestinations} /> : null}
          {step === 4 ? <StyleStep qrStyle={project.qrStyle} companyName={project.brand.companyName} onChange={updateQrStyle} /> : null}
          {step === 5 ? <PreviewStep project={project} /> : null}

          <div className="create-qr-nav">
            <button className="btn btn-secondary" disabled={step === 1} onClick={() => setStep((s) => Math.max(1, s - 1))}>
              Back
            </button>
            {step < TOTAL_STEPS ? (
              <button className="btn btn-primary" disabled={!canAdvanceFromDestinations} onClick={() => setStep((s) => Math.min(TOTAL_STEPS, s + 1))}>
                Next
              </button>
            ) : (
              <button
                className="btn btn-accent"
                disabled={!hasValidDestination || cloud.saving}
                onClick={async () => {
                  if (await cloud.save()) navigate('/codes')
                }}
              >
                {cloud.saving ? 'Saving…' : 'Done — go to My QR Codes'}
              </button>
            )}
          </div>
          {step === 3 && !hasValidDestination ? <p className="error" style={{ marginTop: 8 }}>Add at least one destination before generating the QR.</p> : null}
        </div>

        <QRPreviewPanel
          project={project}
          showDownloads={step === TOTAL_STEPS}
          onChangeDesign={updateDesignConfig}
          onDynamicQrCreated={setDynamicQrInfo}
        />
      </div>
    </div>
  )
}
