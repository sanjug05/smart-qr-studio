# Smart QR Studio

Create a branded QR code that opens up to **five** destinations from a single scan — website, location, brochure, virtual tour, and one more you define. The QR is **self-contained**: it encodes everything the customer landing page needs directly in its own URL, so it works on any device that scans it — no account, no app install, no dependency on the creator's browser.

Smart QR Studio itself is not branded to any company. **AIS** is only a sample brand used to demonstrate the product — every piece of branding (name, logo, colors, destination labels) is user-configurable, for any company.

> **Live limitation, stated up front:** V1 has no backend. The QR/share link itself is fully self-contained and works cross-device (see [Self-contained shareable QR](#self-contained-shareable-qr-cross-device) below) — that was fixed after real-world testing found it broken. What's still local-only is the *creator's* convenience: "My QR Codes," editing, and the export/import backup all live in this browser's `localStorage` only. And because everything a scan needs is baked into the QR at generation time, **editing a project after printing its QR does not update that already-printed code** — see the [known limitation](#known-limitations-summary) on this. Both are inherent to a no-backend V1 and are called out in the app itself.

## Features

- **One scan, up to 5 destinations** — Website, Location, Brochure, Virtual Tour, and a fully custom fifth slot. Every label, URL, icon, and description is editable; destinations can be reordered by drag-and-drop and toggled on/off.
- **Self-contained shareable QR** — the QR encodes a compact, versioned payload of the brand and destinations directly in its own URL (`https://your-domain/#/q/p.<encoded-payload>`), so it resolves on any device with zero dependency on the creator's browser. See [Self-contained shareable QR](#self-contained-shareable-qr-cross-device).
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
    share/         Self-contained payload encode/decode + ShareLinkService abstraction
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

## Self-contained shareable QR (cross-device)

**This is the architecture that makes the product actually work as a QR code** — a QR generated on a desktop must resolve correctly when scanned on a phone that has never talked to that desktop's browser. V1 has no backend, so the only place that data can live is inside the QR's own URL.

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

- **Uploaded logos and custom destination icons are never embedded.** They're base64 image data that can run tens of KB — encoding one into the QR itself would either blow past QR capacity or force a much denser, harder-to-scan code. V1 has no image hosting to reference a URL instead, so branding on a *shared* QR falls back to the existing initials-avatar (the same fallback already used when no logo is set). The **builder's own "Preview customer page"** shows this same fallback, not the uploaded logo, specifically so the creator isn't shown a preview that overpromises what a real scan will look like.
- **QR *visual* styling (module shape, colors, branding style) is not part of the payload.** That's how the QR looks, not what the landing page needs to render — keeping it out of the payload keeps the payload smaller with no loss of function.

### Backward compatibility

QR codes generated before this feature existed used a short plain slug (`#/q/abc123`), resolved via `localStorage.getBySlug()` — and only ever worked in the creator's own browser. Both formats are still recognized: a `p.`-prefixed token decodes directly (`.` never appears in base64url output, so there's no ambiguity to guess at); anything else is treated as a legacy slug and looked up in local storage, with the existing "QR code not found" explanation if it isn't there. Old codes aren't broken by this change; they just don't gain the cross-device property new ones have.

### Payload size and scan reliability

A realistic 5-destination project (company name, tagline, 5 labels/URLs/descriptions) encodes to roughly **700–750 characters** of URL — measured directly, not estimated (see Testing below). That's meaningfully more data than a short slug, which pushes the QR to a higher version (more, smaller modules). The existing scan-reliability pipeline (`generateVerifiedQr.ts`) already re-verifies every generated code via an independent decode and automatically shrinks or drops branding if verification fails; it now also distinguishes *why* a QR failed — "too much data" gets its own message rather than being blamed on branding that may never have been the problem. In testing, realistic payloads with full initials-branding still verify as scannable; there is no artificial compression step, on the principle of not adding complexity that measured testing didn't show a need for.

### Future migration off self-contained links

`src/services/share/shareLinkService.ts` is the one seam every "what URL does this QR encode" call site goes through (`getShareUrl(project)`) — QR generation, "Copy QR link," PNG/SVG export, and the project list's "Copy link" all call it, none of them construct a URL themselves. V1's implementation encodes everything into the URL; a V2 backend would instead POST the project and get back a short ID-based URL — which is also what would finally make "edit destinations after printing" retroactive (see the known limitation below). Only `shareLinkService.ts` would change.

## How QR branding works

A common but unreliable idea is to reshape a QR code's own data/timing modules into letterforms. Standard QR decoders are not guaranteed to tolerate that, and it actively fights the code's own error-correction math. **Smart QR Studio does not do this.**

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

```bash
npm install
npm run dev
```

Open the printed local URL. The customer landing page route is available at `/#/q/<slug>` for any project you've created.

### Build & checks

```bash
npm run build      # type-checks with tsc, then builds with Vite into dist/
npm run preview    # serve the production build locally (needed to test the PWA/offline behavior — the dev server doesn't register a service worker)
npm run typecheck  # tsc -b only, no build output
npm run lint       # ESLint (typescript-eslint + react-hooks + react-refresh + jsx-a11y)
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
npm run build          # do NOT set VITE_BASE_PATH here — see note below
npx cap add android   # requires Android Studio
npx cap add ios        # requires Xcode, macOS
npx cap sync
npx cap open android   # or: npx cap open ios
```

**Base path matters here.** The GitHub Pages build sets `VITE_BASE_PATH=/<repo-name>/` so assets resolve under a project-site subpath. Capacitor serves the bundle from its own local origin (`https://localhost` on Android per `capacitor.config.ts`'s `androidScheme`), not a GitHub Pages subpath — building for Capacitor with a stale `/<repo-name>/` base would 404 every asset. Build with `VITE_BASE_PATH` unset (or explicitly `/`) before `npx cap sync`.

Three things worth doing at that point (not needed for the web build):
- Swap `localStorage` in `src/services/storage/projectRepository.ts` for `@capacitor/preferences` (same `ProjectRepository` interface — only that one file changes).
- Confirm camera-based "scan to test" flows use the device camera rather than assuming a desktop webcam.
- Re-run through the manual test matrix on a real device — the PWA/offline and responsive-layout testing described in this README was done in a desktop browser, not inside a native WebView.

**What's still needed for an actual store submission** (out of scope for V1, listed here so it isn't confused with "done"): app icons/splash screens in each platform's required sizes, a signed release build (keystore for Android, provisioning profile + certificate for iOS), store listing assets (screenshots, privacy policy URL, content rating), and a real device test pass in Android Studio / Xcode. Nothing here has been done — `npx cap add` only scaffolds the native project shell.

## Future dynamic QR capability

The eventual target, once a backend exists:

```
User creates QR → QR gets a permanent ID → QR points at a server-backed URL
  → user edits destinations later → printed QR is unchanged
  → customer automatically sees the updated destinations, from any device
```

**Today, cross-device scanning already works** — that's the whole point of the self-contained payload architecture above. What V1 *cannot* do is make an already-printed QR retroactive: since the payload is baked into the code at generation time, editing a project afterward only affects *new* QR codes generated from it, not ones already scanned into someone's camera roll or already printed. That's the one piece a backend would add, not cross-device resolution itself (already solved).

**What's needed for that last piece:** a backend implementing the same `ProjectRepository` interface (`src/services/storage/projectRepository.ts`) over HTTP instead of `localStorage`, and `shareLinkService.ts`'s `getShareUrl()` swapped to return a short server-backed URL instead of an encoded payload. No other UI, QR-generation, or routing code would need to change — that's the point of both abstractions.

## Future analytics (not implemented)

Not built in V1 by design (see scope notes below), but the data model leaves room for it: each `QRProject` has a stable `slug`, and each `Destination` has a stable `id` — the natural keys a future scan/click-tracking table would join against (scan count, destination-click counts, device/date breakdowns). No analytics code, tracking script, or personal-data collection exists today.

## What's intentionally out of scope for V1

Per product scope: no authentication, no payments/subscriptions, no team management, no CRM, no backend/database, no social login, no complex admin panel, no PDF export. These are architecturally possible to add later without a rewrite, but weren't built now.

## Error recovery

- **Corrupted or foreign `localStorage` data** never crashes the app. Reads are wrapped in try/catch (malformed JSON → treated as empty), and every record is run through a runtime shape guard (`isValidProject`) before it's trusted — a record that doesn't look like a `QRProject` is silently dropped rather than passed to a component that expects one. The same guard is applied to Settings → Import, so a foreign or hand-edited JSON file can't inject malformed data either; the UI reports how many entries were actually imported vs. skipped.
- **Storage quota exceeded** (e.g. several large uploaded logos filling the browser's localStorage limit) is caught and surfaced as a specific, readable error in the builder rather than an unhandled promise rejection.
- **A top-level React error boundary** (`src/components/layout/ErrorBoundary.tsx`) wraps the app, the customer landing route, and the studio route tree separately, so an unexpected render error in one area doesn't take down the whole app, and shows a "Reload" action instead of a blank screen. It specifically recognizes stale-chunk errors (a tab left open across a redeploy) and tells the user to reload for the latest version.
- **Slug collisions** are checked (not just assumed impossible) before a new project is created — see `createUniqueProject()` in `src/services/storage/projectRepository.ts`.

## Dependency audit

`npm audit` currently reports 3 advisories, none of which are exploitable in how this app actually uses the affected packages:

- **esbuild / vite / vite-plugin-pwa** (moderate — dev server can be reached by other local processes): only affects the local **dev server**, which never runs in production; the built static output has no server component at all.
- **react-router / react-router-dom** (moderate — open redirect via `<Link>`/`useNavigate` with a backslash-prefixed target): only reachable if untrusted input is passed as a navigation target to React Router's own APIs. This app never does that — `navigate()` is only ever called with hardcoded internal paths, and the one place user-controlled URLs are rendered (destination links on the landing page) uses a plain `<a href>`, validated against an http/https allowlist, not React Router's navigation.
- **@capacitor/cli → tar** (critical — path traversal during archive extraction): `@capacitor/cli` is a dev-only dependency for a future `npx cap add` step; no native platform has been added, and the vulnerable code path (extracting a tar archive) never runs during normal web development or the GitHub Pages build.

None of these were left unaddressed by omission — each was checked against this codebase's actual usage before being judged non-blocking. Re-run `npm audit` before upgrading any of the three, since a future non-breaking patch may resolve them without needing the major-version bumps `npm audit fix --force` currently proposes.

## Testing performed

This is what was actually run and observed, not assumed:

**Automated**
- `npm run typecheck` (`tsc -b`) — clean, no errors.
- `npm run lint` (ESLint 9, flat config, with `typescript-eslint`, `react-hooks`, `react-refresh`, and `jsx-a11y` — a real lint setup was added during the production audit; it previously only aliased to the type-checker) — clean, no errors or warnings.
- `npm run build` — production build succeeds; verified the `/q/:slug` route's JS chunk contains no reference to `jsQR`/`QRCodeStyling` by grepping the built output directly, confirming the QR-generation libraries are genuinely excluded from the customer-facing bundle rather than just assumed to be.

**QR generation & branding**
- Verified-scannable badge confirmed for: no branding, uploaded logo, initials, full company name, and the "custom" style.
- Company-name matrix tested end-to-end in the builder (not just at the unit level): `AIS`, `ABC`, `ABCD`, `AT&T`, `Global Industrial Solutions` (falls back to initials "GIS" with an explained message), and `日本電気株式会社` (8-character Japanese name — confirmed the width-measurement fix correctly falls back to initials "日本電", which the old character-count heuristic would have missed).
- PNG export validated at the byte level (not just "the browser generated something"): intercepted the actual exported data URI, confirmed the PNG signature bytes, decoded the IHDR chunk's declared width/height, and independently decoded it as a bitmap image (480×480, matching the configured size).
- SVG export validated similarly: confirmed well-formed XML, correct width/height attributes, no `<script>` tags, no inline event-handler attributes, no external resource references — the embedded branding logo is a self-contained base64 data URI, so the file has no broken references when opened standalone.

**Landing page**
- Direct navigation to `/#/q/:slug` in a fresh tab (no builder state) — loads correctly.
- Full page reload on the landing route — survives with no blank page.
- Invalid/unknown slug — shows the "QR code not found" state, not a crash or blank page.
- Browser back and forward between a valid landing page and the not-found state — both work correctly (tested explicitly, not assumed from HashRouter's general behavior).
- Disabling a destination in the builder and reloading a separate tab on that project's landing page — the disabled destination is hidden and destination order/custom labels are preserved.
- A destination URL saved without a scheme (e.g. `example.com`) is normalized before being used as an `href`, so it resolves as an absolute external link rather than a broken relative path against the hash-routed page (found and fixed during this audit).

**Self-contained QR / cross-device resolution** — this is the critical property, so it got the most scrutiny:
- Generated a 5-destination project's share link, opened it in a **separate browser tab, then ran `localStorage.clear()` in that tab and reloaded from scratch** — the landing page still rendered correctly (company name, tagline, all 5 destinations, correct order, correct colors, correct absolute destination URLs). This proves the decode path has no localStorage dependency; it does not substitute for scanning with a real second physical device (see "Not verified" below).
- Downloaded the actual PNG the builder produces, decoded it independently with a **separate copy of jsQR loaded from a different source** than the app's own bundled copy, and confirmed the decoded text matches the exact 739-character share URL character-for-character.
- Ran a payload-validation matrix through the real route: valid payload, empty company name, zero destinations, unknown schema version (`v:2`), a destination with a `javascript:` URL, invalid JSON, invalid base64, and a truncated token — every malformed case produced the clean "Invalid QR code" screen with zero console errors; the valid one rendered normally.
- A payload with one safe destination and two `javascript:`/`data:` destinations mixed in rendered only the safe one — confirms per-destination filtering, not just all-or-nothing rejection, and confirms unsafe URLs surviving decode is not possible.
- A legacy plain-slug QR (the pre-fix format) still resolves via the old localStorage lookup when present, and still shows the (now more accurately worded) "QR code not found" explanation when it isn't — confirming the fix didn't regress backward compatibility.
- Measured real payload/URL size for the AIS sample project (5 destinations, tagline, descriptions): **739 characters total**. The resulting QR is visibly denser than the old slug-based one but still passed the internal verified-scannable check with initials branding active.

**Storage & error handling**
- Manually corrupted `localStorage` (invalid JSON) and reloaded — app recovers to an empty state with no console errors and no crash.
- Verified that visiting `/create` without making any change does not persist a blank project (no junk entries in "My QR Codes").
- Verified Settings → Export produces valid JSON and Import round-trips it; import of a file with some invalid entries reports how many were skipped.

**PWA**
- Production build's `manifest.webmanifest` inspected directly: valid JSON, correct name/short_name/theme_color/background_color/display, and both icon files exist as valid 192×192 and 512×512 PNGs matching the manifest's declared sizes.
- Service worker registration confirmed to reach `activated` state against the production build (`vite preview`), and its precache list inspected directly — it includes every JS/CSS chunk, the icons, and the manifest.
- **Offline capability was actually tested, not just inferred from the manifest existing**: with the service worker active, the underlying server process was killed and the page reloaded — the app fully rendered from cache with zero console errors. This is genuine evidence of offline capability, specifically for the app shell; it does not extend to anything that would require a live network request (there currently is none in V1's normal usage).

**Responsive / accessibility**
- Checked for horizontal scrolling and layout breakage at 1440px, 1280px, 768px, 390px, and 375px viewport widths across the dashboard, the builder wizard (all 4 steps), and the landing page. Sidebar nav collapses to a bottom tab bar at the documented breakpoint; the QR preview panel and download buttons remain fully usable and un-clipped at the narrowest width tested.
- `jsx-a11y` lint rules surfaced and fixed real issues: two form-control groups (module style, branding style) were using bare `<label>` text not associated with any control — restructured as `<fieldset>`/`<legend>`; a radio input's accessible name relied on ambiguous nested markup — given an explicit `aria-label`; a modal backdrop's click-to-dismiss handler was on a non-interactive element with no keyboard equivalent — restructured so the dialog role sits on the actual dialog panel and the backdrop's click-outside-to-close is documented as a pointer-only convenience backed by an existing Escape-key handler and visible close button.

**Not verified** (no access to physical devices in this environment): scanning a **printed** QR, or any QR, with an **actual phone camera** — including an iPhone — has not been done. The "cross-device" testing above proves the architecture has no localStorage dependency (a separate browser context with storage explicitly cleared resolves the link correctly) and that the exact bytes of the downloaded PNG independently decode to the right URL via a decoder separate from the app's own — that is real, meaningful evidence the fix works, but it is not the same as a physical camera scan under real lighting, at real print size, from a real distance. If you test this with an actual phone and it doesn't work, that's a gap this testing could not catch.

## Sample brand configuration

Click **"Try a sample (AIS)"** on the Dashboard to load a fully filled-out example project — company name, tagline, colors, all five destinations, and initials-based QR branding — so the whole flow can be seen end-to-end without typing anything in first. AIS is a demonstration brand only; nothing in the codebase is hard-coded to it (see `src/services/storage/sampleProject.ts`). Deleting the sample project, or never clicking the button at all, doesn't affect anything else — every screen works from a fresh, empty state.

## Known limitations (summary)

Scattered through the sections above; collected here for a quick scan:

- **Editing a project after generating its QR does not update already-generated codes.** The payload is baked in at generation time (see [Self-contained shareable QR](#self-contained-shareable-qr-cross-device)) — a printed/shared QR is a snapshot. Generate a new QR after making changes if you need the update reflected.
- **The *creator's* "My QR Codes" is still local-only** — every project lives in one browser's `localStorage` for editing purposes. Moving devices, clearing site data, or using a different browser means the creator loses editing access to past projects (already-generated QR codes are unaffected — they're self-contained). Export/import (Settings) is the only current way to move that editing data between browsers, and it's manual.
- **No logo or custom destination icons on a shared/scanned QR** — deliberately excluded from the payload to keep the QR scannable (see above); the initials-avatar fallback is used instead. The builder's own logo upload still works for in-app preview.
- **QR branding fits are verified, not guaranteed under all real-world conditions.** The internal jsQR check proves the exported bitmap is decodable by a standards-compliant reader; it can't account for print quality, camera hardware, lighting, or scan distance.
- **Initials for non-Latin, non-space-delimited names are a plain truncation**, not a linguistically meaningful abbreviation (see the QR branding section above).
- **No analytics, no scan tracking, no accounts** — by design for V1, not an oversight. The data model (stable slugs and destination IDs) is ready for it later.
- **Not tested on a real mobile device or in a native WebView.** All testing in this README was done in a desktop browser with emulated viewports/user agents and cross-device resolution verified by clearing `localStorage` in a second browser tab (see Testing below) rather than an actual second physical device; Capacitor packaging has not been performed (see the Android/iOS section above).
- **Three dev/transitive-dependency `npm audit` advisories are open**, judged non-blocking for the reasons given in "Dependency audit" above, not silently ignored.

## Future roadmap

Roughly in order of what would unlock the most value next, per the architecture decisions already in place:

1. **Backend-backed `ProjectRepository` + `ShareLinkService`** — cross-device *scanning* already works (self-contained payload); a backend would add retroactive editing of already-generated QR codes, cross-device *management* of the creator's own project list, and is the prerequisite for accounts, sharing, and analytics.
2. **Scan/click analytics** — once a backend exists, log against the existing stable `slug`/`destination.id` keys; surface counts on a Dashboard the "lightweight" version already has a placeholder shape for.
3. **Native packaging** — `npx cap add android/ios`, swap `localStorage` for `@capacitor/preferences`, and a real-device test pass (see the Capacitor section above for exactly what's already in place vs. what remains).
4. **PDF export** — deliberately not attempted in V1 per the original scope ("do not implement PDF unless it can be done properly"); revisit once there's a concrete print/layout use case to design against.
