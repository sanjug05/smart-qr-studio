import { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import AppShell from '@/components/layout/AppShell'
import LoadingScreen from '@/components/layout/LoadingScreen'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { PwaUpdateProvider } from '@/hooks/usePwaUpdate'
import { InstallPromptProvider } from '@/hooks/useInstallPrompt'

// Route-level code splitting matters most here: the customer-facing
// landing page (/q/:slug) must load fast on a phone straight off a QR
// scan, so it must never pull in the QR *generation* libraries
// (qr-code-styling, jsqr) that only the studio/builder screens need.
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const CreateQR = lazy(() => import('@/pages/CreateQR'))
const MyQRCodes = lazy(() => import('@/pages/MyQRCodes'))
const Settings = lazy(() => import('@/pages/Settings'))
const Landing = lazy(() => import('@/pages/Landing'))
const NotFound = lazy(() => import('@/pages/NotFound'))

export default function App() {
  return (
    <ErrorBoundary>
      {/*
        Both providers are mounted once here, above the router, regardless
        of route — beforeinstallprompt can fire before any particular page
        mounts, and the service worker must register for the customer
        landing route too (offline support covers the whole app, not just
        the studio). Only their *visual* output (PwaUpdateBanner,
        InstallAppPrompt) is scoped to studio routes — see AppShell,
        Dashboard, and Settings.
      */}
      <PwaUpdateProvider>
        <InstallPromptProvider>
          <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Suspense fallback={<LoadingScreen />}>
              <Routes>
                <Route
                  path="/q/:slug"
                  element={
                    <ErrorBoundary>
                      <Landing />
                    </ErrorBoundary>
                  }
                />
                <Route
                  path="/*"
                  element={
                    <AppShell>
                      <ErrorBoundary>
                        <Suspense fallback={<LoadingScreen />}>
                          <Routes>
                            <Route path="/" element={<Dashboard />} />
                            <Route path="/create" element={<CreateQR />} />
                            <Route path="/create/:id" element={<CreateQR />} />
                            <Route path="/codes" element={<MyQRCodes />} />
                            <Route path="/settings" element={<Settings />} />
                            <Route path="*" element={<NotFound />} />
                          </Routes>
                        </Suspense>
                      </ErrorBoundary>
                    </AppShell>
                  }
                />
              </Routes>
            </Suspense>
          </HashRouter>
        </InstallPromptProvider>
      </PwaUpdateProvider>
    </ErrorBoundary>
  )
}
