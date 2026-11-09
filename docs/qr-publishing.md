# Publishing Smart QR Studio to sanjugupta.com/qr (Option D: keyless, operator-controlled)

GitHub **prepares** the application. A person on a local machine **controls every Hosting release**.
No GitHub workflow holds a Google credential or can call the Hosting API.

## Who does what

| Step | Who / where | Credential |
|---|---|---|
| Build, test, scan, fingerprint | `qr-build.yml` (GitHub, CI only) | none |
| Enable the publisher service account | Owner (`sanjumanager88@gmail.com`) | Owner's own gcloud session |
| Obtain a 900-second token for the publisher | Operator (`sanju.gupta90@gmail.com`), own gcloud configuration | operator's own session |
| Plan, preview, release | Operator, `scripts/deploy-qr-hosting.mjs` on a local machine | the short-lived token only |
| Disable the publisher service account | Owner | Owner's own gcloud session |

The publisher refuses any other credential: no key file, no user login, no Firebase CLI fallback.

## The security boundary (read this)

The publisher service account needs `firebasehosting.sites.update`. **IAM cannot limit that permission to one site,
one channel or one path.** While the account is enabled and a token exists, that token could, in principle, change
anything on any Hosting site in the project. The restrictions in `scripts/lib/qrPublisher.mjs` (project, site, channel
names, `/qr/` only, plan hash, typed confirmation, no DELETE) are **application-level controls inside this program,
not an IAM boundary**. The real protections are: the account is disabled except during an approved window, tokens last
15 minutes, no keys exist, only the operator can mint tokens, and every release is gated by a plan hash that a person
approved.

## 1. Get the build

Open the `QR Build (CI only)` run for the commit to publish, download the artifact `qr-build-<commit>` and unzip it so
that `dist/` and `build-manifest.json` sit side by side. Do not rebuild locally for a release: the artifact is the
approved input and the publisher re-checks every file against the manifest.

## 2. Plan (read-only) — produces the hash a person approves

```powershell
$env:QR_PUBLISHER_TOKEN = '<token minted for this session; never typed into chat or saved>'
node scripts/deploy-qr-hosting.mjs --mode preview --channel qr-pv-20261109-<id> --dist dist --manifest build-manifest.json `
  --expected-live-version <current live version id> --plan-only --plan-out plan.json
```

The plan lists the live version, the hashes of every non-`/qr` file and of the non-`/qr` configuration, the artifact,
the exact `/qr` changes, and `nonQrChanges: 0`. It ends with `PLAN_SHA256=<hash>`.

## 3. Preview (single-use channel)

Same command without `--plan-only`, plus `--plan-sha256 <hash>`. A preview channel must be named
`qr-pv-<yyyymmdd>-<id>`, is created fresh, expires after 48 hours, and is never reused. The old `qr-preview` channel is
protected. A preview URL is public and shows a copy of the **whole** site: do not share it.

## 4. Live (exactly one release, after the preview was verified)

```powershell
node scripts/deploy-qr-hosting.mjs --mode live --dist dist --manifest build-manifest.json `
  --expected-live-version <current live id> --tested-version <the verified preview version id> `
  --plan-only --plan-out plan-live.json            # then repeat without --plan-only, with:
  --plan-sha256 <live plan hash> --confirm PUBLISH-CLEAN-QR-TO-LIVE --receipt-out "$HOME\Downloads\QR-release-records\<name>.json" --operator <who>
```

Live mode refuses unless the new version is byte-identical (files and configuration) to the tested preview version.

## 5. Roll back

```powershell
node scripts/deploy-qr-hosting.mjs --mode rollback --target-version <previous version id> `
  --expected-live-version <current live id> --confirm ROLLBACK-QR-TO-<previous version id>
```

The only write is re-releasing that exact earlier, finalized version.

## 6. Audit (read-only, any time)

```powershell
$env:QR_READ_TOKEN = (gcloud auth print-access-token)
node scripts/audit-qr-live.mjs --receipt "$HOME\Downloads\QR-release-records\<name>.json"
Remove-Item Env:QR_READ_TOKEN
```

Reports every file or configuration difference between live now and the last receipt, flagging anything outside `/qr`.

Always clear the token afterwards: `Remove-Item Env:QR_PUBLISHER_TOKEN`.
