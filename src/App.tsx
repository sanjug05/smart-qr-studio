import { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import AppShell from '@/components/layout/AppShell'
import LoadingScreen from '@/components/layout/LoadingScreen'

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
    <HashRouter>
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/q/:slug" element={<Landing />} />
          <Route
            path="/*"
            element={
              <AppShell>
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
              </AppShell>
            }
          />
        </Routes>
      </Suspense>
    </HashRouter>
  )
}
