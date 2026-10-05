# Smart QR Studio

Create a branded QR code that opens up to **five** destinations from a single scan — website, location, brochure, virtual tour, and one more you define. Every project chooses a **QR Type**:

- **Static QR** — self-contained. The QR encodes everything the customer landing page needs directly in its own URL, so it works on any device that scans it, fully offline, forever — no account, no app install, no backend involved at all.
- **Dynamic QR** — the QR encodes only a permanent identifier. A backend resolves it to the *currently published* destinations on every scan, so destinations can be updated after the QR is printed without reprinting it. See [Dynamic QR architecture](#dynamic-qr-architecture) below.

Smart QR Studio itself is not branded to any company. **AIS** is only a sample brand used to demonstrate the product — every piece of branding (name, logo, colors, destination labels) is user-configurable, for any company, and the QR Type choice is available to every project regardless of who's using it.

> **Live limitations, stated up front:** Static QR is fully self-contained and cross-device by design (see [Self-contained shareable QR](#self-contained-shareable-qr-cross-device)) — editing a project after printing its *Static* QR does not retroactively update that already-printed code, since everything it needs is baked in at generation time. **Dynamic QR removes that specific limitation** — its whole purpose is to make destinations editable after printing — but it currently uses an anonymous per-QR management token rather than real account-based ownership; see [Current limitations](#current-limitations). The *creator's* "My QR Codes" list, and everything about wizard drafts, still lives in this browser's `localStorage` only, for both QR types.

## Features

- **One scan, up to 5 destinations** — Website, Location, Brochure, Virtual Tour, and a fully custom fifth slot. Every label, URL, icon, and description is editable; destinations can be reordered by drag-and-drop and toggled on/off. Both QR types support the same five destinations, with the same landing page.
- **Static or Dynamic QR, chosen explicitly per project** — the wizard's first step, defaulting to Static; existing projects from before this choice existed are always treated as Static and are never auto-converted. See [Dynamic QR architecture](#dynamic-qr-architecture).
- **Self-contained shareable QR (Static)** — the QR encodes a compact, versioned payload of the brand and destinations directly in its own URL (`https://your-domain/#/q/p.<encoded-payload>`), so it resolves on any device with zero dependency on the creator's browser or any backend. See [Self-contained shareable QR](#self-contained-shareable-qr-cross-device).
- **Editable-after-printing QR (Dynamic)** — the QR encodes a permanent identifier (`https://your-domain/#/q/d.<publicId>`); a backend resolves current destinations on every scan. See [Dynamic QR architecture](#dynamic-qr-architecture).
- **Designed, branded exports** — a full presentation layer (logo/initials → headline → QR → call-to-action) across three templates (Clean/Premium/Classic), independent of whether the underlying QR is Static or Dynamic. PNG, SVG, and a self-contained clickable HTML export ("Digital QR"), all sharing one composition engine.
- **Company identity inside the QR** — None / Logo / Company initials / Company name / Custom, rendered as a safe centered image with high error correction. Automatically falls back to initials (or drops branding) if a decode check fails. See [How QR branding works](#how-qr-branding-works).
- **Internal scan validation** — every generated QR is decoded by an independent decoder (jsQR) before being called "verified," with a visible badge and automatic fallback if verification fails.
- **Premium, mobile-first customer landing page** — brand identity, tagline, and destination cards; works standalone at `/#/q/...` with no dependency on the builder UI, for both QR types.
- **5-step builder wizard** (QR Type → Brand → Destinations → QR Style → Preview) with a persistent live QR preview and a full "preview the customer page" phone-frame view.
- **Local project storage** with JSON export/import for backup, and a clear-all-data control (Settings).
- **Provider-neutral entitlements** — Dynamic QR is gated behind a `canUse('dynamicQr')` check, not billing-specific code; see [Entitlements](#entitlements).
- **PWA-ready** (installable, offline app-shell caching) and **Capacitor-ready** for later Android/iOS packaging without an architecture rewrite.
- **Responsive, accessible UI** — keyboard-navigable, visible focus states, semantic HTML, 44px+ touch targets, alt text on all images.

## Technology stack

- **React 18 + TypeScript + Vite** — fast dev server, small optimized production build. Deployed as a static site (GitHub Pages) — unchanged by Dynamic QR.
- **react-router-dom (HashRouter)** — client-side routing that works on GitHub Pages with zero server-side rewrite rules, and survives a hard refresh on `/#/q/...` for either QR type.
- **qr-code-styling** — QR rendering with per-module styling, SVG/PNG/canvas export, and image (logo) embedding with configurable error correction.
- **jsQR** — independent, pure-JS QR decoder used only for the internal scan-reliability check (see below); never used for anything user-facing.
- **vite-plugin-pwa** — manifest + service worker generation. No `runtimeCaching` rule exists for the Dynamic QR API — every resolution request always hits the network (see [Caching](#caching)).
- **Firebase Cloud Functions + Firestore** (`backend/`) — the Dynamic QR API. A separate, independently deployed TypeScript project; see [Dynamic QR architecture](#dynamic-qr-architecture).
- No state-management library, no CSS framework, no UI kit — plain React state/context and hand-written CSS, kept deliberately small so the customer-facing landing page stays fast.

## Project structure

```
src/
  types/            Core data model (QRProject, Destination, BrandConfig, QRStyleConfig, entitlements)
  lib/               Pure helpers: URL/image validation, file reading
  services/
    qr/              QR generation, company-identity branding, scan validation, designed-export composition
    share/           Self-contained payload encode/decode + ShareLinkService (Static AND Dynamic URL building)
    storage/         ProjectRepository abstraction (localStorage today, backend-ready)
    dynamicQr/       DynamicQrService (HTTP client) + DynamicQrAuthorizationService (management-token isolation)
    entitlements/    EntitlementService — the one place canUse('dynamicQr') is decided
  hooks/             useProjectDraft, useVerifiedQr, useDynamicQr, useEntitlement, useProjects
  features/landing/  The actual customer-facing landing page component (shared by both QR types)
  components/
    layout/          App shell (sidebar nav / mobile tab bar)
    wizard/          QR Type/Brand/Destinations/Style/Preview step components, QR preview panel
    common/          Shared small components (EmptyState, ProjectCard)
  pages/             Route-level screens (Dashboard, CreateQR, MyQRCodes, Settings, Landing, NotFound)

backend/             Dynamic QR API — Firebase Cloud Functions + Firestore. Independently deployed; see below.
  src/
    routes/          resolve (public) / create, update, status (management, token-authorized)
    lib/              validation, ids (publicId + management token), auth, entitlements, cors
    handler.ts       the whole API as a plain Request → Response function
    store.ts         QrStore interface — firestoreStore.ts (production) / memoryStore.ts (tests)
    index.ts         the Cloud Function (`api`) adapter
  test/              Vitest against the real handler + an in-memory store (no network, no Firebase account required)
```

Business logic (QR generation, branding, validation, storage, Dynamic QR service calls) is fully decoupled from UI components — every service under `src/services` is a plain TypeScript module with no React or DOM-framework dependency beyond the Canvas/Blob/fetch APIs it needs, so it can be reused unchanged inside a Capacitor WebView.

## Self-contained shareable QR (cross-device)

**This is the architecture that makes Static QR actually work as a QR code** — a QR generated on a desktop must resolve correctly when scanned on a phone that has never talked to that desktop's browser. Static QR has no backend, so the only place that data can live is inside the QR's own URL.

```
Creator builds project → build a minimal ShareableQRPayload → base64url-encode it
  → QR encodes https://your-domain/#/q/p.<encoded-payload>
  → scanned on ANY device → payload decoded client-side → landing page renders
```

No `localStorage.getBySlug()` lookup is involved in that path at all. This was a real bug found in first-round real-device testing: an earlier version encoded only a short local slug, which resolved fine in the browser that created it and showed "QR code not found" on every other device — the opposite of a working product.

### The payload (`src/services/share/sharePayload.ts`)

`ShareableQRPayload` is deliberately minimal and uses short field names — every byte here is a byte the QR has to physically encode, and QR data capacity is a real constraint on scan reliability (see below):

```ts
interface ShareableQRPayload {
  v: 1                          // schema version
  n: string                     // company name
  t?: string                    // tagline
  p: string; s: string; bg: string  // primary / secondary / background color
  d: { l: string; u: string; i: string; de?: string }[]  // label, url, icon, description
}
```

`buildShareablePayload(project)` includes only enabled destinations with a valid http/https URL, capped at 5, in display order — disabled destinations and anything beyond the fifth would never be shown, so they're not worth the bytes. `encodeSharePayload`/`decodeSharePayload` handle base64url (URL-safe, no padding) encoding of the UTF-8 JSON. **No `eval`, no `Function()`, no arbitrary code execution anywhere in this path.**

### Validation is not optional here

`decodeSharePayload` treats its input as fully untrusted — it's data from a URL a stranger's camera app just opened. Decoding failures, JSON that doesn't parse, an unrecognized `v`, a missing company name, and destination URLs that don't pass the same http/https allowlist the builder uses are all rejected; a payload where every destination gets filtered out this way is treated as invalid rather than silently rendering an empty landing page. The result is one of: a rendered landing page, or a clean **"Invalid QR code"** screen — never an uncaught error.

### What's deliberately excluded, and why

- **Uploaded logos and custom destination icons are never embedded in a Static QR's payload.** They're base64 image data that can run tens of KB — encoding one into the QR itself would either blow past QR capacity or force a much denser, harder-to-scan code. Static QR has no image hosting to reference a URL instead, so branding on a *shared* Static QR falls back to the existing initials-avatar (the same fallback already used when no logo is set). Dynamic QR's backend-stored content is not under this constraint (see below), since the QR itself never grows regardless of content size.
- **QR *visual* styling (module shape, colors, branding style) is not part of the payload.** That's how the QR looks, not what the landing page needs to render — keeping it out of the payload keeps the payload smaller with no loss of function.

### Backward compatibility

Three QR link formats are recognized, dispatched in `src/pages/Landing.tsx` by an unambiguous prefix — never by length or pattern guessing:

- `p.<payload>` — Static QR, decoded client-side (this section).
- `d.<publicId>` — Dynamic QR, resolved via the backend (see [Dynamic QR architecture](#dynamic-qr-architecture)).
- anything else — a legacy plain slug (`#/q/abc123`) from before either format existed, resolved via `localStorage.getBySlug()`, which only ever works in the creator's own browser.

All three converge on the same `LandingContent` → `LandingView` rendering. Old codes of any format aren't broken by later additions; they just don't gain properties introduced afterward.

### Payload size and scan reliability

A realistic 5-destination project (company name, tagline, 5 labels/URLs/descriptions) encodes to roughly **700–750 characters** of URL — measured directly, not estimated (see Testing below). That's meaningfully more data than a short slug, which pushes the QR to a higher version (more, smaller modules). The existing scan-reliability pipeline (`generateVerifiedQr.ts`) already re-verifies every generated code via an independent decode and automatically shrinks or drops branding if verification fails; it now also distinguishes *why* a QR failed — "too much data" gets its own message rather than being blamed on branding that may never have been the problem. In testing, realistic payloads with full initials-branding still verify as scannable; there is no artificial compression step, on the principle of not adding complexity that measured testing didn't show a need for. (Dynamic QR sidesteps this entirely — its QR only ever encodes a short fixed-length `publicId`, regardless of how much content is behind it.)

### The seam this was designed around

`src/services/share/shareLinkService.ts` is the one seam every "what URL does this QR encode" call site goes through — QR generation, "Copy QR link," PNG/SVG export, and the project list's "Copy link" all call `getShareUrl(project)` (Static) or `getDynamicShareUrl(publicId)` (Dynamic); none of them construct a URL themselves. This is exactly what let Dynamic QR be added without touching the designed-export pipeline (`qrExport.ts`, `designComposition.ts`) at all — those files only ever consume an already-built QR instance, never caring how its data was derived.

## Dynamic QR architecture

### Why

Static QR's one real limitation: since the payload is baked into the code at generation time, editing a project afterward only affects *new* QR codes, not ones already printed or scanned into someone's camera roll. Dynamic QR exists specifically to remove that limitation, at the cost of requiring a backend and network access at scan time.

### How it resolves

```
Static:   #/q/p.<payload>   → decode client-side           → LandingContent → LandingView
Dynamic:  #/q/d.<publicId>  → GET /v1/qr/:publicId (API)    → LandingContent → LandingView
Legacy:   #/q/<slug>        → local ProjectRepository       → LandingContent → LandingView
```

`publicId` is permanent — printed QR artwork encodes it directly (`https://your-domain/#/q/d.<publicId>`) and it never changes, regardless of how many times the project's brand or destinations are edited afterward. There is no redirect to a single destination: the backend returns the full current `LandingContent` (brand + up to 5 destinations), and the existing `LandingView` component renders it exactly as it renders a decoded Static payload — **one landing-page implementation, two ways of arriving at the content it renders.**

### Backend (`backend/`)

A separate, independently deployable project — a single public HTTPS Firebase Cloud Function (`api`, Node 22) backed by Firestore — chosen for: no servers to run and no idle cost, a plain HTTPS JSON API usable identically from this GitHub-Pages-hosted frontend and a future Capacitor app, and TypeScript end-to-end. The whole API is a plain `Request → Response` function (`backend/src/handler.ts`) over a small `QrStore` interface, so routing, validation, authorization and entitlement are tested directly with no Firebase involved; only `firestoreStore.ts` and the `index.ts` adapter touch Firebase. It has its own `package.json`, `tsconfig.json`, and test suite, and is deployed independently of the frontend's GitHub Pages workflow. The Firebase project is `smart-qr-studio-app` (`.firebaserc`).

**Data model** — one Firestore collection, `dynamic_qr/{publicId}` (the `publicId` is the document id, so uniqueness is enforced by Firestore and a published id can never be recreated):

```
dynamic_qr/{publicId} { publicId, ownerId, tokenHash, status, content, version, createdAt, updatedAt }
```

- `content` is a single map shaped exactly like `LandingContent` — no separate "backend payload" schema to keep in sync with the frontend's idea of a project.
- Updates read the document, check authorization, and write the complete new `content` plus `version + 1` in one **Firestore transaction**, never as partial field patches — concurrent publishes serialize, versions have no gaps or duplicates, and a reader only ever sees the fully-old or fully-new document.
- `status` is `active` | `disabled`; documents are never deleted, so a disabled `publicId` can never later be silently reissued to different content.
- `tokenHash` is the SHA-256 of the management token; the token itself is never stored. Public resolution returns only `status`, `content` and `version`.
- **Firestore rules deny every client read/write** (`firestore.rules`). Only the Cloud Function (Admin SDK) touches the collection, so nothing can bypass the API's validation or authorization.
- A Firestore document is capped at 1 MiB, so the whole published content — including logo/icon images embedded as data URLs — is capped at ~900 KB (`MAX_CONTENT_BYTES`, rejected with a clear 422). Keep logos small (a few hundred KB at most).
- No `users`, `plans`, or `analytics` collections exist yet — see [Current limitations](#current-limitations).

**API:**

```
GET   /v1/qr/:publicId            public — no authorization required
POST  /v1/qr                      management — requires the dynamicQr entitlement
PUT   /v1/qr/:publicId            management — requires a management token
PATCH /v1/qr/:publicId/status     management — requires a management token
```

Every destination URL is re-validated server-side (`backend/src/lib/validation.ts`), independently of whatever the client already checked — only `http:`/`https:` are accepted; `javascript:`, `data:`, `vbscript:`, and any other scheme is rejected. Destinations are capped at 5 (extras are silently dropped, matching `buildShareablePayload`'s existing behavior for Static QR); label/description/company-name lengths are capped to match the wizard's own form limits.

### Authorization

Full user accounts don't exist yet. `POST /v1/qr` instead returns a high-entropy **management token** exactly once; the backend stores only its SHA-256 hash. Every `PUT`/`PATCH` requires `Authorization: Bearer <token>`, checked in constant time. **The public `publicId` is never itself sufficient to edit anything** — resolving a QR and managing it are deliberately separate surfaces.

On the frontend, every bit of this logic is isolated behind `src/services/dynamicQr/dynamicQrAuthorizationService.ts` — no other file reads or writes the token, or builds an `Authorization` header itself. That isolation is the point: replacing "does this device hold the right token" with "does the logged-in user own this `publicId`" later is a change to that one file's implementation, not to `publicId`, the Dynamic QR URL format, the public resolution API, the database schema, or `LandingView`.

The wizard makes the V1 limitation this implies explicit, in a single low-key line next to "Publish changes" — not a warning banner, and never shown on the customer-facing landing page: *"Your management access is stored on this device. Account-based QR management will be added later."*

### Entitlements

A provider-neutral `Plan`/`EntitlementKey` model, defined independently on both sides (`src/types/entitlements.ts` on the frontend, `backend/src/lib/entitlements.ts` on the backend — see [Validation & entitlement duplication](#validation--entitlement-duplication) for why they're two copies, not one shared package):

```ts
Plan = 'free' | 'pro' | 'business'
PLAN_ENTITLEMENTS = { free: { dynamicQr: false }, pro: { dynamicQr: true }, business: { dynamicQr: true } }
```

No `users`/`plans` table exists, so entitlement is currently decided by the **deployed environment** alone. The product is currently operated at **Business level** (no Free/Pro/Business tiers are sold yet): the GitHub Pages build sets `VITE_DEFAULT_PLAN=business` and the backend defaults `DEFAULT_PLAN` to `business` (`backend/src/config.ts`), so Dynamic QR is available with no Pro badge. Both are optional, validated (`free` | `pro` | `business`, anything else is ignored) and default safely when absent: `development` and `staging` behave as `pro`, a `production` deployment with no plan set defaults every visitor to `free`. Reintroducing tiers later means removing or changing those two values, not any call site. The wizard never inlines a plan comparison — it calls `entitlementService.canUse('dynamicQr')` (`src/hooks/useEntitlement.ts`) and shows Dynamic QR as a locked, "Upgrade to Pro"-labeled option when that's `false`, rather than hiding it. **The backend enforces the identical rule independently on `POST /v1/qr`, so a direct API call — or a tampered frontend bundle that lies about `canUse()` — can't bypass what's actually granted;** the wizard only ever controls what's *shown*, never what's actually possible against the real backend. **No billing provider — Stripe, Razorpay, App Store/Play billing, or otherwise — is referenced anywhere**; connecting one later means replacing the entitlement service's implementation with one that reads a real per-account plan, not changing any call site.

**Testing Dynamic QR against a production-configured backend, safely:** production defaulting every visitor to `free` is a deliberate, hard-to-misconfigure safety property — but it also means a backend deployed with `ENVIRONMENT=production` can't normally be entitlement-tested at all. A narrow, fail-closed escape hatch exists for exactly that: provisioning a *secret* (`DYNAMIC_QR_TEST_OVERRIDE_SECRET`, never a plain config value and never committed — nothing provisions one by default) lets a request to `POST /v1/qr` carrying a matching `X-Dynamic-QR-Test-Override` header bypass the environment default, for that request only. This is not a general-purpose flag:

- It is a request **header**, never a query parameter — never logged in access logs or shareable-by-URL the way a query string is.
- With no secret provisioned (every environment's actual default, including production), the override path doesn't just "default to off" — the check (`isTestOverrideActive` in `backend/src/lib/entitlements.ts`) returns `false` unconditionally before it ever compares anything, so there is no code path where an unset secret can be tricked into matching.
- It has no relationship to `localStorage`, cookies, or any other client-stored state. Editing a browser's storage cannot influence it, because the backend never reads any of that — only its own secret binding and the one request header.
- The frontend's own awareness of it (`VITE_DYNAMIC_QR_TEST_OVERRIDE_SECRET`, `src/services/dynamicQr/config.ts`) is baked in at **build time** for a deliberately separate test build — never present in a normal production build, and not something reachable by editing already-shipped JavaScript in a browser, since a real production bundle simply never contains a secret value to extract.
- Knowing the frontend's value proves nothing on its own: the backend independently requires its own separately-provisioned secret to match, so leaking one side without the other grants nothing.

Configuration (`ENVIRONMENT`, `DEFAULT_PLAN`, `ALLOWED_ORIGINS`) lives in `backend/src/config.ts` as Cloud Functions params with in-repo defaults (`business` plan, `https://sanjug05.github.io` + `http://localhost:5173` origins); override with a `.env` file or the environment.

### Caching

The service worker precaches the static app shell only; there is no `runtimeCaching` rule for the Dynamic QR API, so every `GET /v1/qr/:publicId` always hits the network directly. A destination changed via `PUT` is visible on the very next scan — it cannot get stuck behind a stale service-worker cache entry.

### Offline behaviour

- **Static QR**: works fully offline, exactly as before — it never makes a network request.
- **Dynamic QR**: requires network access to resolve. If the backend can't be reached, the customer sees **"An internet connection is required for this QR"** — this is deliberately a distinct state from "Invalid QR code," since the QR itself is fine and the failure is transient.

### Disabled QR

A Dynamic QR can be set to `disabled` (via `PATCH .../status`) without deleting its record. A disabled QR shows a branded **"QR code unavailable"** page to scanners, distinct from both "not found" and the offline state. Disabling never weakens authorization — a disabled record still requires the exact same valid management token to be updated as an active one does (verified by test); an update to a disabled QR can change its content without ever silently reactivating it, since `status` and `content` are independent columns touched by independent, separately-authorized endpoints.

### Validation & entitlement duplication

Two small pieces of logic exist independently on both sides rather than as one shared package:

- **URL validation** — the `http:`/`https:`-only allowlist exists in `src/lib/validation.ts` (frontend) and `backend/src/lib/validation.ts` (backend).
- **Entitlement mapping** — the `Plan`/`PLAN_ENTITLEMENTS` shape exists in `src/types/entitlements.ts` (frontend) and `backend/src/lib/entitlements.ts` (backend).

**The backend copy is what's actually authoritative in both cases — this is verified, not assumed.** Every backend test that exercises URL validation or entitlement (`backend/test/api.test.ts`, `backend/test/entitlements.test.ts`) calls the handler directly as a `Request → Response` function, with no frontend code in the loop at all — a malicious or malformed request (a `javascript:` URL, an oversized field, a forged entitlement-override header, a request claiming to be from an already-tampered frontend bundle) is rejected purely by the backend's own checks. The frontend's copies exist only to give the wizard fast, offline-friendly feedback before a request is ever sent; removing them entirely would degrade UX, not security, because the backend never trusts anything the client already claims to have checked.

**Why not one shared package:** the frontend (Vite/browser) and backend (Firebase Cloud Functions) are two independently deployed projects with separate `package.json`s, separate `tsconfig.json`s, and no monorepo tooling (no shared workspace, no build-order coordination) connecting them. Introducing a shared package for roughly 30 stable, rarely-changing lines would mean either a path-based cross-project import (coupling two independent deploy pipelines' module resolution together) or an actual monorepo/workspace restructuring — real ongoing complexity for a small, low-churn amount of duplication. This was evaluated and deliberately rejected as disproportionate; each copy is small enough to review side-by-side by hand, and both are covered by their own project's tests, so drift would surface as a test failure rather than silently.

## How QR branding works

A common but unreliable idea is to reshape a QR code's own data/timing modules into letterforms. Standard QR decoders are not guaranteed to tolerate that, and it actively fights the code's own error-correction math. **Smart QR Studio does not do this — for either QR type.**

Instead, every branding style — Logo, Company Initials, Company Name, Custom — resolves to a small **image** dropped into the center of the code, exactly like a logo watermark:

1. The QR is always generated at **error-correction level H** (~30% of the code can be damaged/obscured and still decode).
2. Text styles (initials/company name) are rendered onto an offscreen canvas first, producing a bitmap — from the QR engine's point of view, "AIS" and an uploaded PNG logo are handled identically.
3. `hideBackgroundDots` + a capped `imageSize` (12–28% of the code area depending on style) keep the obscured area centered and bounded, never scattered across the code.
4. **After generation, the QR is independently decoded** (via `jsQR`, a separate implementation from the encoder) and compared against the expected URL.
   - If it decodes correctly → shown as "✓ Verified scannable."
   - If not → the branding footprint is automatically shrunk and re-validated, and if that still fails, branding is dropped entirely and the user is told: *"QR branding is too aggressive. Please reduce the branding area or use a simpler style."*
5. A company name too long to render legibly at a safe size is **automatically swapped for initials**, with a visible explanation.

### The "too long" decision is measured, not counted

Earlier builds used a flat 10-character cutoff to decide when a company name needed to fall back to initials. That's a poor proxy: a 10-character Latin name and a 10-character string in a wide script (CJK, for example) do not occupy the same rendered width, and a character count can't tell them apart. An 8-character Japanese company name, for instance, is undercounted by length alone — it can be visually denser on the branding plate than a longer Latin name.

`resolveBranding` (`src/services/qr/branding.ts`) now measures the **actual rendered glyph width** via Canvas2D `measureText`, using the same font stack the branding image is really drawn with, at the smallest still-legible font size (28px on the 240px branding canvas). If the text doesn't fit at that size, it falls back to initials — regardless of character count. This is verified to correctly catch cases the old heuristic would have missed (e.g. "日本電気株式会社", 8 characters, now correctly falls back to initials; "AT&T" and "ABCD" correctly render as full text).

### Limitations, stated honestly

- This is **not** a guarantee that every physical camera, under every lighting condition, at every print size, will scan the code — that depends on print quality, camera hardware, and distance, none of which software can fully control. The internal check only proves the encoded bitmap is decodable by a standards-compliant reader.
- The QR's own modules are never turned into letterforms — "branding inside the QR" here means a controlled central image, not decorative data modules. This is the industry-standard safe approach used by most reputable QR-branding tools.
- Very long company names cannot be rendered as full-text branding at a safe size — the app detects this (by measurement, see above) and substitutes initials automatically rather than shipping an unreliable code.
- `companyInitials()` (`src/lib/validation.ts`) is a Latin-centric multi-word-abbreviation heuristic (first letter of each of the first 3 space-separated words, or the first 3 characters of a single word). For scripts without a comparable "initials" convention — CJK names being the clearest example — the fallback is a plain truncation to the first few characters, not a linguistically meaningful abbreviation. It's still deterministic and still passes the scan-reliability check, just not idiomatic for every language.

## Getting started

### Frontend

```bash
npm install
npm run dev
```

Open the printed local URL. The customer landing page route is available at `/#/q/p.<payload>` (Static) or `/#/q/d.<publicId>` (Dynamic) for any project you've created.

### Backend (only needed for Dynamic QR)

```bash
cd backend
npm install
npm run test              # the whole API against an in-memory store — no network, no Firebase account needed
```

To run it locally end-to-end, use the Firebase emulators (`firebase emulators:start --only functions,firestore`; the Firestore emulator needs a recent JDK) and put the Functions emulator URL in `.env.local`, e.g. `VITE_DYNAMIC_QR_API_BASE_URL=http://127.0.0.1:5001/<project-id>/us-central1/api`. The frontend has **no built-in API default** — a build without `VITE_DYNAMIC_QR_API_BASE_URL` fails closed for Dynamic QR. Static QR development and testing never requires the backend at all.

### Build & checks

```bash
# frontend
npm run build      # type-checks with tsc, then builds with Vite into dist/
npm run preview    # serve the production build locally (needed to test the PWA/offline behavior — the dev server doesn't register a service worker)
npm run typecheck  # tsc -b only, no build output
npm run lint       # ESLint (typescript-eslint + react-hooks + react-refresh + jsx-a11y) — backend/ is excluded, it has its own toolchain

# backend (cd backend first)
npm run typecheck
npm run build       # compiles to lib/ (what Firebase deploys)
npm run test        # Vitest against the real handler + an in-memory store — no network, no Firebase account needed
```

### Environment variables

**Frontend** (see [`.env.example`](.env.example)):

```bash
VITE_BASE_PATH=/smart-qr-studio/                    # subpath for a GitHub Pages *project* site; "/" for a custom domain or user/org site
VITE_DYNAMIC_QR_API_BASE_URL=https://<function-host>       # the Dynamic QR API origin (Firebase Function); no default; production builds require a public https URL; set as the DYNAMIC_QR_API_BASE_URL repo variable in CI
```

Neither is a secret. The frontend has no secrets of its own.

**Backend** — no runtime secrets exist; configuration (CORS allowlist, environment name, default plan) are plain Cloud Functions params in `backend/src/config.ts`. CI authenticates to Firebase with a `FIREBASE_SERVICE_ACCOUNT` GitHub secret (a service-account JSON key — never committed). Never commit a real secret.

## Deploying

### Frontend — GitHub Pages

A ready-to-use workflow lives at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). It builds on every push to `main` and deploys via GitHub's native Pages actions (no personal token needed). **Unchanged by Dynamic QR** — the frontend remains a static site regardless of which QR type a project uses.

1. Push this repository to GitHub.
2. In the repo's **Settings → Pages**, set "Source" to **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the Actions tab).
4. The site is published at `https://<your-username>.github.io/<repo-name>/`.

The workflow sets `VITE_BASE_PATH` to `/<repo-name>/` automatically. If you deploy to a **custom domain** instead, edit the workflow to set `VITE_BASE_PATH=/` (or remove the env line, since `/` is the default). Set `VITE_DYNAMIC_QR_API_BASE_URL` to wherever the backend is actually deployed (see below) before building for production.

Because routing uses `HashRouter`, there is no need for a `404.html` SPA-redirect trick — every route, including `/#/q/...`, is just a URL fragment the static host never sees, so a hard refresh or a shared deep link always resolves correctly, for both QR types.

### Backend — Firebase Cloud Functions + Firestore

One Firebase project (`smart-qr-studio-app`, see `.firebaserc`) hosts the Firestore database and the `api` Cloud Function. **One-time setup** (requires the project on the Blaze plan — Cloud Functions needs it — and `firebase login`):

```bash
firebase deploy --only firestore,functions        # from the repo root; builds backend/ first (firebase.json predeploy)
```

The deployed function URL (printed by the deploy, `https://api-<hash>-uc.a.run.app`) is the value of the `DYNAMIC_QR_API_BASE_URL` **repository variable**, which the Pages workflow injects as `VITE_DYNAMIC_QR_API_BASE_URL` (a public URL, so a variable rather than a secret; the workflow refuses non-https or localhost values).

A backend-specific GitHub Actions workflow ([`.github/workflows/deploy-backend.yml`](.github/workflows/deploy-backend.yml)) redeploys automatically on every push to `main` that touches `backend/**` or the Firebase config — it runs `typecheck`, `test` and `build`, fails with an explicit message if the `FIREBASE_SERVICE_ACCOUNT` secret is missing, then deploys Functions and Firestore rules.

The backend's URL is independent of the frontend's hostname by design — `publicId` and stored content never reference where the API is served from, so introducing a custom API domain or a custom frontend domain later is a configuration change, not a data migration.

## Android/iOS packaging (Capacitor-ready, not yet packaged)

The codebase deliberately avoids browser-only assumptions in its business logic (storage is behind `ProjectRepository`, QR generation/branding/validation/Dynamic QR calls are plain TS modules), so wrapping the production build as a native app is expected to be a Capacitor `add`, not a rewrite. [`capacitor.config.ts`](capacitor.config.ts) is already in place; `@capacitor/core` and `@capacitor/cli` are installed as dev dependencies. **No native platforms have been added or published** — that's an explicit, deliberate scope boundary.

When you're ready:

```bash
npm run build          # do NOT set VITE_BASE_PATH here — see note below
npx cap add android   # requires Android Studio
npx cap add ios        # requires Xcode, macOS
npx cap sync
npx cap open android   # or: npx cap open ios
```

**Base path matters here.** The GitHub Pages build sets `VITE_BASE_PATH=/<repo-name>/` so assets resolve under a project-site subpath. Capacitor serves the bundle from its own local origin (`https://localhost` on Android per `capacitor.config.ts`'s `androidScheme`), not a GitHub Pages subpath — building for Capacitor with a stale `/<repo-name>/` base would 404 every asset. Build with `VITE_BASE_PATH` unset (or explicitly `/`) before `npx cap sync`. `VITE_DYNAMIC_QR_API_BASE_URL` should point at the real deployed backend, not localhost, for any build that will run outside your dev machine.

Three things worth doing at that point (not needed for the web build):
- Swap `localStorage` in `src/services/storage/projectRepository.ts` (and `dynamicQrAuthorizationService.ts`'s token storage) for `@capacitor/preferences` — same interfaces, only those files change.
- Confirm camera-based "scan to test" flows use the device camera rather than assuming a desktop webcam.
- Re-run through the manual test matrix on a real device — the PWA/offline and responsive-layout testing described in this README was done in a desktop browser, not inside a native WebView.

**What's still needed for an actual store submission** (out of scope, listed here so it isn't confused with "done"): app icons/splash screens in each platform's required sizes, a signed release build (keystore for Android, provisioning profile + certificate for iOS), store listing assets (screenshots, privacy policy URL, content rating), and a real device test pass in Android Studio / Xcode. Nothing here has been done — `npx cap add` only scaffolds the native project shell.

## Future account migration

The explicit design goal: a user creates a Dynamic QR on a laptop, later edits it from a phone, and the printed QR — same `publicId` — automatically reflects the change. Nothing in the current architecture blocks this: `dynamicQrAuthorizationService.ts` is the only file that needs to change (anonymous bearer token → authenticated-session ownership check), and `owner_id` already exists as a nullable column on `dynamic_qr`, ready to be populated once real accounts exist. `publicId`, the Dynamic QR URL format, the public resolution API, the database schema's shape, and `LandingView` are all designed to be untouched by that migration.

## Future analytics (not implemented)

Not built by design (see scope notes below), but the data model leaves room for it on both QR types: a Static `QRProject` has a stable `slug` and stable `Destination.id`s; a Dynamic QR has a stable `publicId` and the same destination IDs inside its `content`. Either is a natural key a future scan/click-tracking table would join against. The Dynamic QR backend's resolution handler (`backend/src/routes/resolve.ts`) is the obvious insertion point for a future scan-logging call — **nothing is collected today**, and nothing should be added without an explicit product/privacy decision first (location, IP, device, referrer, etc. are all currently untouched).

## What's intentionally out of scope

Per product scope: no full authentication/accounts, no payments/subscriptions/billing-provider integration, no team management, no CRM, no scan/click analytics, no social login, no complex admin panel, no PDF export. Dynamic QR's backend and entitlement *architecture* now exist specifically so these can be added later without a rewrite — see [Future account migration](#future-account-migration) and [Entitlements](#entitlements) — but none of them are built now.

## Error recovery

- **Corrupted or foreign `localStorage` data** never crashes the app. Reads are wrapped in try/catch (malformed JSON → treated as empty), and every record is run through a runtime shape guard (`isValidProject`) before it's trusted — a record that doesn't look like a `QRProject` is silently dropped rather than passed to a component that expects one. The same guard is applied to Settings → Import, so a foreign or hand-edited JSON file can't inject malformed data either; the UI reports how many entries were actually imported vs. skipped.
- **Storage quota exceeded** (e.g. several large uploaded logos filling the browser's localStorage limit) is caught and surfaced as a specific, readable error in the builder rather than an unhandled promise rejection.
- **A top-level React error boundary** (`src/components/layout/ErrorBoundary.tsx`) wraps the app, the customer landing route, and the studio route tree separately, so an unexpected render error in one area doesn't take down the whole app, and shows a "Reload" action instead of a blank screen. It specifically recognizes stale-chunk errors (a tab left open across a redeploy) and tells the user to reload for the latest version.
- **Slug collisions** are checked (not just assumed impossible) before a new project is created — see `createUniqueProject()` in `src/services/storage/projectRepository.ts`. The Dynamic QR backend applies the equivalent check-and-retry to `publicId` generation (`backend/src/routes/create.ts`).
- **Dynamic QR content is always replaced atomically** (see [Dynamic QR architecture](#dynamic-qr-architecture)) — an invalid update is rejected in full server-side validation, never partially applied; the previously published content and version remain untouched.

## Dependency audit

`npm audit` (frontend) currently reports 3 advisories, none of which are exploitable in how this app actually uses the affected packages:

- **esbuild / vite / vite-plugin-pwa** (moderate — dev server can be reached by other local processes): only affects the local **dev server**, which never runs in production; the built static output has no server component at all.
- **react-router / react-router-dom** (moderate — open redirect via `<Link>`/`useNavigate` with a backslash-prefixed target): only reachable if untrusted input is passed as a navigation target to React Router's own APIs. This app never does that — `navigate()` is only ever called with hardcoded internal paths, and the one place user-controlled URLs are rendered (destination links on the landing page) uses a plain `<a href>`, validated against an http/https allowlist, not React Router's navigation.
- **@capacitor/cli → tar** (critical — path traversal during archive extraction): `@capacitor/cli` is a dev-only dependency for a future `npx cap add` step; no native platform has been added, and the vulnerable code path (extracting a tar archive) never runs during normal web development or the GitHub Pages build.

None of these were left unaddressed by omission — each was checked against this codebase's actual usage before being judged non-blocking. Re-run `npm audit` before upgrading any of the three, since a future non-breaking patch may resolve them without needing the major-version bumps `npm audit fix --force` currently proposes. The backend (`backend/`) is a separate `package.json` with its own dependency tree — run `npm audit` inside `backend/` separately.

## Testing performed

This is what was actually run and observed, not assumed:

**Automated (frontend)**
- `npm run typecheck` (`tsc -b`) — clean, no errors.
- `npm run lint` (ESLint 9, flat config, with `typescript-eslint`, `react-hooks`, `react-refresh`, and `jsx-a11y`) — clean, no errors or warnings. `backend/` is excluded from this config (it has its own tsconfig/runtime globals) rather than linted with frontend rules that don't apply to it.
- `npm run build` — production build succeeds; verified the `/q/...` route's JS chunk contains no reference to `jsQR`/`QRCodeStyling` by grepping the built output directly (for both the pre-Dynamic-QR and post-Dynamic-QR builds), confirming the QR-generation libraries are genuinely excluded from the customer-facing bundle rather than just assumed to be. Landing chunk size before/after adding Dynamic QR: ~1.9KB → ~3.0KB (the Dynamic QR resolution client, not QR-generation code).

**Automated (backend)**
- `npm run typecheck` — clean, no errors.
- `npm run test` (Vitest against the real handler with an in-memory store, plus the Firestore adapter against a fake Firestore) — 60 tests, all passing: create, resolve (active/disabled/not-found), update (authorized/missing-token/invalid-token), status toggle (disable/re-enable, authorization-required), malicious URL schemes (`javascript:`, `data:`, `vbscript:`) rejected, more-than-5-destinations silently capped, oversized fields truncated rather than rejected, invalid hex colors rejected, over-large content rejected, concurrent updates each apply completely with gap-free versions, only the token hash is stored, public resolution exposes only `status`/`content`/`version`, and CORS preflight/origin-reflection.

**QR generation & branding**
- Verified-scannable badge confirmed for: no branding, uploaded logo, initials, full company name, and the "custom" style.
- Company-name matrix tested end-to-end in the builder (not just at the unit level): `AIS`, `ABC`, `ABCD`, `AT&T`, `Global Industrial Solutions` (falls back to initials "GIS" with an explained message), and `日本電気株式会社` (8-character Japanese name — confirmed the width-measurement fix correctly falls back to initials "日本電", which the old character-count heuristic would have missed).
- PNG export validated at the byte level (not just "the browser generated something"): intercepted the actual exported data URI, confirmed the PNG signature bytes, decoded the IHDR chunk's declared width/height, and independently decoded it as a bitmap image.
- SVG export validated similarly: confirmed well-formed XML, correct width/height attributes, no `<script>` tags, no inline event-handler attributes, no external resource references.

**Landing page**
- Direct navigation to `/#/q/...` in a fresh tab (no builder state) — loads correctly for all three link formats.
- Full page reload on the landing route — survives with no blank page.
- Invalid/unknown link — shows the "QR code not found" state, not a crash or blank page, with wording specific to which format was being resolved.
- Browser back and forward between a valid landing page and the not-found state — both work correctly.
- Disabling a destination in the builder and reloading a separate tab on that project's landing page — the disabled destination is hidden and destination order/custom labels are preserved.
- A destination URL saved without a scheme (e.g. `example.com`) is normalized before being used as an `href`, so it resolves as an absolute external link rather than a broken relative path against the hash-routed page.

**Self-contained QR / cross-device resolution (Static)** — this is a critical property, so it got the most scrutiny:
- Generated a 5-destination project's share link, opened it in a **separate browser tab, then ran `localStorage.clear()` in that tab and reloaded from scratch** — the landing page still rendered correctly (company name, tagline, all 5 destinations, correct order, correct colors, correct absolute destination URLs).
- Downloaded the actual PNG the builder produces, decoded it independently with a **separate copy of jsQR loaded from a different source** than the app's own bundled copy, and confirmed the decoded text matches the exact share URL character-for-character.
- Ran a payload-validation matrix through the real route: valid payload, empty company name, zero destinations, unknown schema version (`v:2`), a destination with a `javascript:` URL, invalid JSON, invalid base64, and a truncated token — every malformed case produced the clean "Invalid QR code" screen with zero console errors.
- A payload with one safe destination and two `javascript:`/`data:` destinations mixed in rendered only the safe one — confirms per-destination filtering, not just all-or-nothing rejection.
- A legacy plain-slug QR still resolves via the old localStorage lookup when present, and shows the correct "QR code not found" explanation when it isn't.

**Dynamic QR — cross-device resolution, in a real browser (not just backend unit tests)**
- Created a Dynamic QR in one browser tab (management context, holding the management token in its own `localStorage`); the QR panel showed a permanent `publicId` and a badge, with the underlying QR encoding `#/q/d.<publicId>` (confirmed by reading `landing-url` directly, and by decoding the actual exported PNG with jsQR).
- Opened that exact `#/q/d.<publicId>` URL in a **separate browser tab with its `localStorage` cleared**, before publishing any changes — the landing page correctly rendered the *original* (pre-edit) destinations by resolving from the backend alone.
- Edited the Website destination in the management tab and clicked "Publish changes" — confirmed via a direct backend request that the stored content and `version` both updated, while `publicId` stayed identical.
- Reloaded the separate, storage-cleared tab — it now rendered the *updated* destination, proving the resolve path depends on nothing but the backend and the URL's `publicId`, never on any browser's local state.
- Disabled the same Dynamic QR via the management API and reloaded the scanning tab — got the branded "QR code unavailable" state, not a generic error. Re-enabled it and confirmed normal resolution returned.
- Stopped the backend entirely and reloaded the scanning tab — got "An internet connection is required for this QR," not "Invalid QR code." Restarted the backend and confirmed a fresh scan recovered normally.
- Requested a genuinely unknown `publicId` — got the Dynamic-specific "QR code not found" wording (distinct from the legacy-slug wording).
- Exported Designed PNG, Designed SVG, and Digital QR HTML for a Dynamic QR project and confirmed each one's embedded QR decodes to the exact `#/q/d.<publicId>` URL, never the destination data — the same designed-export code path used for Static QR, unmodified.
- Created a fresh Static QR project immediately afterward and confirmed its share link is still exactly `p.<payload>`, the "✓ Verified scannable" badge still appears, and no Dynamic-only UI (badge, "Publish changes") is shown — confirming the two paths don't leak into each other.

**Storage & error handling**
- Manually corrupted `localStorage` (invalid JSON) and reloaded — app recovers to an empty state with no console errors and no crash.
- Verified that visiting `/create` without making any change does not persist a blank project (no junk entries in "My QR Codes") — true for both Static and Dynamic project drafts.
- Verified Settings → Export produces valid JSON and Import round-trips it; import of a file with some invalid entries reports how many were skipped.

**PWA**
- Production build's `manifest.webmanifest` inspected directly: valid JSON, correct name/short_name/theme_color/background_color/display, and both icon files exist as valid 192×192 and 512×512 PNGs matching the manifest's declared sizes.
- Service worker registration confirmed to reach `activated` state against the production build (`vite preview`), and its precache list inspected directly — it includes every JS/CSS chunk, the icons, and the manifest, and does **not** include any Dynamic QR API response (there is no `runtimeCaching` rule for it — verified by inspecting the generated service worker source directly).
- **Offline capability was actually tested, not just inferred from the manifest existing**: with the service worker active, the underlying server process was killed and the page reloaded — the app fully rendered from cache with zero console errors, for the Static QR flow. Dynamic QR resolution during that same test correctly showed the "connection required" state rather than pretending to work offline.

**Responsive / accessibility**
- Checked for horizontal scrolling and layout breakage at 1440px, 1280px, 768px, 390px, and 375px viewport widths across the dashboard, the builder wizard (all 5 steps, including the new QR Type step), and the landing page.
- `jsx-a11y` lint rules surfaced and fixed real issues over time: form-control groups using bare `<label>` text not associated with any control were restructured as `<fieldset>`/`<legend>`; radio inputs relying on ambiguous nested markup were given explicit `aria-label`s (including the new QR Type step's two options); a modal backdrop's click-to-dismiss handler was moved off a non-interactive element onto the dialog panel itself, backed by an existing Escape-key handler and visible close button.

**Not verified** (no access to physical devices in this environment): scanning a **printed** QR, or any QR — Static or Dynamic — with an **actual phone camera** has not been done. The cross-device testing above proves both architectures have no dependency on any single browser's local state, and that exported files independently decode to the correct URL via a decoder separate from the app's own — that is real, meaningful evidence, but it is not the same as a physical camera scan under real lighting, at real print size, from a real distance.

## Sample brand configuration

Click **"Try a sample (AIS)"** on the Dashboard to load a fully filled-out example project — company name, tagline, colors, all five destinations, and initials-based QR branding — so the whole flow can be seen end-to-end without typing anything in first. AIS is a demonstration brand only; nothing in the codebase is hard-coded to it (see `src/services/storage/sampleProject.ts`), including the Dynamic QR architecture, which is entirely data-driven regardless of QR type. Deleting the sample project, or never clicking the button at all, doesn't affect anything else — every screen works from a fresh, empty state.

## Current limitations

- **Editing a *Static* QR's project after generating its QR does not update already-generated codes.** The payload is baked in at generation time (see [Self-contained shareable QR](#self-contained-shareable-qr-cross-device)) — a printed/shared Static QR is a snapshot. This is exactly what Dynamic QR exists to solve; use it instead when you expect destinations to change after printing.
- **Dynamic QR management is currently anonymous, not account-based.** Authorization is a per-QR secret token stored in `localStorage` on whichever device created it (see [Authorization](#authorization)) — not a real login. Losing that browser's storage (clearing site data, switching browsers) means that specific device can no longer publish changes to QRs it created; the QR keeps resolving normally for scanners regardless, since resolution never reads `localStorage`. There is currently no way to recover a lost management token or transfer management to another device.
- **No accounts, no `users`/`plans` tables, no billing.** Entitlement is decided per-deployment-environment, not per-user; upgrading a specific real user from Free to Pro is not implemented, only the architectural seam for it (see [Entitlements](#entitlements)).
- **No scan/click analytics on either QR type**, by design — see [Future analytics](#future-analytics-not-implemented).
- **Backend and frontend independently duplicate a couple of small modules** (the URL-validation allowlist rules, the entitlement plan map) — see [Validation & entitlement duplication](#validation--entitlement-duplication) for why, and for how it's verified that the backend copy remains authoritative regardless. Keep both copies in sync by hand if either changes.
- **No backend CI/CD workflow yet** — deploys are manual (`npm run deploy:<environment>` from `backend/`) until a GitHub Actions workflow is added for it.
- **The *creator's* "My QR Codes" is still local-only**, for both QR types — every project (including a Dynamic project's local draft state and, critically, its management token) lives in one browser's `localStorage`. Export/import (Settings) is the only current way to move a project's editing access between browsers, and it does not include Dynamic QR management tokens.
- **No logo or custom destination icons on a *shared/scanned Static* QR** — deliberately excluded from the payload to keep the QR scannable (see above); the initials-avatar fallback is used instead. Dynamic QR's backend-stored content is not under this constraint.
- **QR branding fits are verified, not guaranteed under all real-world conditions** — see [How QR branding works](#how-qr-branding-works).
- **Initials for non-Latin, non-space-delimited names are a plain truncation**, not a linguistically meaningful abbreviation (see the QR branding section above).
- **Not tested on a real mobile device or in a native WebView, and the Firestore adapter is unit-tested against a fake Firestore; the real Firestore and deployed Function are verified by the live acceptance test, not by the automated suite.** Capacitor packaging has not been performed (see the Android/iOS section above).
- **Three dev/transitive-dependency `npm audit` advisories are open** in the frontend, judged non-blocking for the reasons given in "Dependency audit" above, not silently ignored.

## Future roadmap

Roughly in order of what would unlock the most value next, per the architecture decisions already in place:

1. **Real accounts + billing**, replacing Dynamic QR's anonymous management token and the environment-based entitlement default — see [Future account migration](#future-account-migration) and [Entitlements](#entitlements) for exactly what does and doesn't need to change.
2. **Backend CI/CD** — a GitHub Actions workflow deploying `backend/` on push, mirroring the frontend's existing `deploy.yml`.
3. **Scan/click analytics** — log against the existing stable `slug`/`publicId`/`destination.id` keys, starting from the seam already identified in `backend/src/routes/resolve.ts`; a separate, explicit product/privacy decision before any data collection begins.
4. **Native packaging** — `npx cap add android/ios`, swap `localStorage` (including the Dynamic QR management-token store) for `@capacitor/preferences`, and a real-device test pass (see the Capacitor section above for exactly what's already in place vs. what remains).
5. **PDF export** — deliberately not attempted per the original scope ("do not implement PDF unless it can be done properly"); revisit once there's a concrete print/layout use case to design against.
