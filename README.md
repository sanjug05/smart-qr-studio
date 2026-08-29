# Smart QR Studio

Create a branded QR code that opens up to **five** destinations from a single scan — website, location, brochure, virtual tour, and one more you define. The QR never encodes those destination URLs directly; it points at a **smart landing page** that you can keep editing after the code is printed.

Smart QR Studio itself is not branded to any company. **AIS** is only a sample brand used to demonstrate the product — every piece of branding (name, logo, colors, destination labels) is user-configurable, for any company.

> **Live limitation, stated up front:** V1 has no backend. Every project is stored in the creator's browser (`localStorage`) only. A QR generated on one device/browser will only resolve on that same browser until a backend is added — see [Future dynamic QR capability](#future-dynamic-qr-capability). This is called out in the app itself (Dashboard, My QR Codes, Settings).

## Features

- **One scan, up to 5 destinations** — Website, Location, Brochure, Virtual Tour, and a fully custom fifth slot. Every label, URL, icon, and description is editable; destinations can be reordered by drag-and-drop and toggled on/off.
- **Smart-link architecture** — the QR encodes `https://your-domain/#/q/<slug>`, never the destination URLs. See [QR indirection](#qr-indirection--why-a-smart-link).
- **Branded QR generation** — square/rounded/dot module styles, custom foreground/background/transparent, adjustable size and quiet zone, PNG and SVG export, live preview.
- **Company identity inside the QR** — None / Logo / Company initials / Company name / Custom, rendered as a safe centered image with high error correction. Automatically falls back to initials (or drops branding) if a decode check fails. See [How QR branding works](#how-qr-branding-works).
- **Internal scan validation** — every generated QR is decoded by an independent decoder (jsQR) before being called "verified," with a visible badge and automatic fallback if verification fails.
- **Premium, mobile-first customer landing page** — brand identity, tagline, and destination cards; works standalone at `/#/q/:slug` with no dependency on the builder UI.
- **4-step builder wizard** (Brand → Destinations → QR Style → Preview) with a persistent live QR preview and a full "preview the customer page" phone-frame view.
- **Local project storage** with JSON export/import for backup, and a clear-all-data control (Settings).
- **PWA-ready** (installable, offline app-shell caching) and **Capacitor-ready** for later Android/iOS packaging without an architecture rewrite.
- **Responsive, accessible UI** — keyboard-navigable, visible focus states, semantic HTML, 44px+ touch targets, alt text on all images.

## Technology stack

- **React 18 + TypeScript + Vite** — fast dev server, small optimized production build.
- **react-router-dom (HashRouter)** — client-side routing that works on GitHub Pages with zero server-side rewrite rules, and survives a hard refresh on `/#/q/:slug`.
- **qr-code-styling** — QR rendering with per-module styling, SVG/PNG/canvas export, and image (logo) embedding with configurable error correction.
- **jsQR** — independent, pure-JS QR decoder used only for the internal scan-reliability check (see below); never used for anything user-facing.
- **vite-plugin-pwa** — manifest + service worker generation.
- No state-management library, no CSS framework, no UI kit — plain React state/context and hand-written CSS, kept deliberately small so the customer-facing landing page stays fast.

## Project structure

```
src/
  types/          Core data model (QRProject, Destination, BrandConfig, QRStyleConfig)
  lib/             Pure helpers: URL/image validation, file reading
  services/
    qr/            QR generation, company-identity branding, scan validation, export
    storage/       ProjectRepository abstraction (localStorage today, backend-ready)
  hooks/           useProjectDraft (wizard state + autosave), useVerifiedQr, useProjects
  features/landing/  The actual customer-facing landing page component
  components/
    layout/        App shell (sidebar nav / mobile tab bar)
    wizard/        Brand/Destinations/Style/Preview step components, QR preview panel
    common/        Shared small components (EmptyState, ProjectCard)
  pages/           Route-level screens (Dashboard, CreateQR, MyQRCodes, Settings, Landing, NotFound)
```

Business logic (QR generation, branding, validation, storage) is fully decoupled from UI components — every service under `src/services` is a plain TypeScript module with no React or DOM-framework dependency beyond the Canvas/Blob APIs it needs, so it can be reused unchanged inside a Capacitor WebView.

## QR indirection — why a "smart link"

The QR code encodes **only** a landing-page URL:

```
QR code  →  https://your-domain/#/q/abc123  →  branded landing page  →  destination buttons  →  chosen URL opens
```

Destinations are *not* baked into the QR. This means a printed/laminated QR code keeps working even after you change what it points to — see [Future dynamic QR capability](#future-dynamic-qr-capability) for what's needed to make that fully real (a backend), versus what V1 actually does (same-browser local storage).

## How QR branding works

A common but unreliable idea is to reshape a QR code's own data/timing modules into letterforms. Standard QR decoders are not guaranteed to tolerate that, and it actively fights the code's own error-correction math. **Smart QR Studio does not do this.**

Instead, every branding style — Logo, Company Initials, Company Name, Custom — resolves to a small **image** dropped into the center of the code, exactly like a logo watermark:

1. The QR is always generated at **error-correction level H** (~30% of the code can be damaged/obscured and still decode).
2. Text styles (initials/company name) are rendered onto an offscreen canvas first, producing a bitmap — from the QR engine's point of view, "AIS" and an uploaded PNG logo are handled identically.
3. `hideBackgroundDots` + a capped `imageSize` (12–28% of the code area depending on style) keep the obscured area centered and bounded, never scattered across the code.
4. **After generation, the QR is independently decoded** (via `jsQR`, a separate implementation from the encoder) and compared against the expected URL.
   - If it decodes correctly → shown as "✓ Verified scannable."
   - If not → the branding footprint is automatically shrunk and re-validated, and if that still fails, branding is dropped entirely and the user is told: *"QR branding is too aggressive. Please reduce the branding area or use a simpler style."*
5. A company name too long to render legibly at a safe size (>10 characters) is **automatically swapped for initials**, with a visible explanation.

### Limitations, stated honestly

- This is **not** a guarantee that every physical camera, under every lighting condition, at every print size, will scan the code — that depends on print quality, camera hardware, and distance, none of which software can fully control. The internal check only proves the encoded bitmap is decodable by a standards-compliant reader.
- The QR's own modules are never turned into letterforms — "branding inside the QR" here means a controlled central image, not decorative data modules. This is the industry-standard safe approach used by most reputable QR-branding tools.
- Very long company names cannot be rendered as full-text branding at a safe size — the app detects this and substitutes initials automatically rather than shipping an unreliable code.

## Getting started

```bash
npm install
npm run dev
```

Open the printed local URL. The customer landing page route is available at `/#/q/<slug>` for any project you've created.

### Build

```bash
npm run build   # type-checks with tsc, then builds with Vite into dist/
npm run preview # serve the production build locally
```

### Environment variables

There is no backend, so there are no secrets. The single build-time variable is documented in [`.env.example`](.env.example):

```bash
VITE_BASE_PATH=/smart-qr-studio/   # subpath for a GitHub Pages *project* site; "/" for a custom domain or user/org site
```

## Deploying to GitHub Pages

A ready-to-use workflow lives at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). It builds on every push to `main` and deploys via GitHub's native Pages actions (no personal token needed).

1. Push this repository to GitHub.
2. In the repo's **Settings → Pages**, set "Source" to **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the Actions tab).
4. The site is published at `https://<your-username>.github.io/<repo-name>/`.

The workflow sets `VITE_BASE_PATH` to `/<repo-name>/` automatically. If you deploy to a **custom domain** instead, edit the workflow to set `VITE_BASE_PATH=/` (or remove the env line, since `/` is the default).

Because routing uses `HashRouter`, there is no need for a `404.html` SPA-redirect trick — every route, including `/#/q/:slug`, is just a URL fragment the static host never sees, so a hard refresh or a shared deep link always resolves correctly.

## Android/iOS packaging (Capacitor-ready, not yet packaged)

The codebase deliberately avoids browser-only assumptions in its business logic (storage is behind `ProjectRepository`, QR generation/branding/validation are plain TS modules), so wrapping the production build as a native app is expected to be a Capacitor `add`, not a rewrite. [`capacitor.config.ts`](capacitor.config.ts) is already in place; `@capacitor/core` and `@capacitor/cli` are installed as dev dependencies. **No native platforms have been added or published** — that's an explicit, deliberate scope boundary for V1.

When you're ready:

```bash
npm run build
npx cap add android   # requires Android Studio
npx cap add ios        # requires Xcode, macOS
npx cap sync
npx cap open android   # or: npx cap open ios
```

Two things worth doing at that point (not needed for the web build):
- Swap `localStorage` in `src/services/storage/projectRepository.ts` for `@capacitor/preferences` (same `ProjectRepository` interface — only that one file changes).
- Confirm camera-based "scan to test" flows use the device camera rather than assuming a desktop webcam.

## Future dynamic QR capability

The architecture is built around this flow becoming fully real once a backend exists:

```
User creates QR → QR gets a unique slug → QR points at a permanent smart URL
  → user edits destinations later → printed QR is unchanged
  → customer automatically sees the updated destinations
```

**Today**, this already works *within one browser* — edit a project in "My QR Codes" and its `/#/q/:slug` landing page reflects the change immediately, because the same `localStorage` is read at scan time.

**What's missing for true cross-device dynamic QR:** a backend implementing the same `ProjectRepository` interface (`src/services/storage/projectRepository.ts`) over HTTP instead of `localStorage`. No UI, QR-generation, or routing code would need to change — that's the point of the abstraction.

## Future analytics (not implemented)

Not built in V1 by design (see scope notes below), but the data model leaves room for it: each `QRProject` has a stable `slug`, and each `Destination` has a stable `id` — the natural keys a future scan/click-tracking table would join against (scan count, destination-click counts, device/date breakdowns). No analytics code, tracking script, or personal-data collection exists today.

## What's intentionally out of scope for V1

Per product scope: no authentication, no payments/subscriptions, no team management, no CRM, no backend/database, no social login, no complex admin panel, no PDF export. These are architecturally possible to add later without a rewrite, but weren't built now.

## Testing performed

Manually verified in-browser during development:

- QR generates and independently decodes correctly (verified badge) for plain, logo, initials, and company-name branding.
- Long company name automatically falls back to initials with an explained message.
- Destination add/edit/enable-disable/reorder (drag-and-drop) all reflect immediately in the live QR-adjacent preview and the landing-page preview.
- `/#/q/:slug` resolves standalone (new tab, no builder state) and survives a full page reload — HashRouter needs no server rewrite rule.
- Responsive layout checked at desktop and mobile (375×812) viewports — sidebar nav becomes a bottom tab bar, touch targets stay ≥44px.
- Visiting the builder without making changes does not create a stored project (no junk entries in "My QR Codes").
- Production build (`npm run build`) completes with no type errors; the `/q/:slug` route's JS chunk does not include the QR-generation libraries (confirmed via build output), keeping the scanned landing page light.

Not verified (no access to physical devices in this environment): scanning a **printed** QR with a real phone camera under varied lighting, and Safari/iOS-specific rendering. The internal jsQR validation is a real but partial substitute — it proves the bitmap is decodable, not that every camera will read it comfortably at every print size.

## Sample brand configuration

Click **"Try a sample (AIS)"** on the Dashboard to load a fully filled-out example project — company name, tagline, colors, all five destinations, and initials-based QR branding — so the whole flow can be seen end-to-end without typing anything in first. AIS is a demonstration brand only; nothing in the codebase is hard-coded to it (see `src/services/storage/sampleProject.ts`).
