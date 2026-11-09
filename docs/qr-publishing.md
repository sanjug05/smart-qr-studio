# Publishing Smart QR Studio to sanjugupta.com/qr (Option D: keyless, operator-controlled)

GitHub **prepares** the application. A person on a local machine **controls every Hosting release**.
No GitHub workflow holds a Google credential or can call the Hosting API.

## Who does what

| Step | Who / where | Credential |
|---|---|---|
| Build, test, scan, fingerprint; upload the artifact (push to `main` only) | `qr-build.yml` (GitHub, CI only) | none |
| Enable the publisher service account | Owner (`sanjumanager88@gmail.com`) | Owner's own gcloud session |
| Obtain a 900-second token for the publisher | Operator (`sanju.gupta90@gmail.com`), own gcloud configuration | operator's own session |
| Plan, preview, release | Operator, `scripts/deploy-qr-hosting.mjs` on a local machine | the short-lived token only |
| Disable the publisher service account | Owner | Owner's own gcloud session |
| Read-only audit | Operator, `scripts/audit-qr-live.mjs`, dedicated read-only identity | its own short-lived token |

The publisher refuses any other credential: no key file, no user login, no Firebase CLI fallback.

## OAuth scopes — a documented discrepancy, and how it is handled

Two Google sources disagree:

1. The **generic discovery document** for `firebasehosting.googleapis.com` (v1beta1, revision 20261106) declares only
   `firebase`, `firebase.readonly`, `cloud-platform` and `cloud-platform.read-only`.
2. The **method-level Firebase Hosting REST references** list `firebase.hosting` (write methods) and
   `firebase.hosting.readonly` (read methods) as accepted alternatives, next to `firebase`, `cloud-platform` and so on.

Neither source is assumed to be wrong. The evidence (as retrieved on 2026-11-09 through a page-reading tool, so a reviewer
should re-check the pages) is saved in `scripts/test/fixtures/hosting-discovery-subset.json` under `scopeEvidence`.
The policy prefers the **narrowest documented scopes**:

| Use | Required scope (exactly) | Allowed extras (identity only) |
|---|---|---|
| Publisher (writes) | `https://www.googleapis.com/auth/firebase.hosting` | `userinfo.email`, `openid` |
| Canary / read-only audit | `https://www.googleapis.com/auth/firebase.hosting.readonly` | `userinfo.email`, `openid` |

A missing or any additional scope (`firebase`, `firebase.readonly`, `cloud-platform`, `cloud-platform.read-only`, a write
scope on the read-only token) makes the tools **refuse**.

**Proof against the real API comes first and is read-only.** The canary (read-only identity, `firebase.hosting.readonly`)
runs real Hosting GET requests before any publishing permission is exercised. If the API rejects a Hosting-specific scope:
the exact error is recorded, **nothing is silently broadened**, the canary stays read-only, and the documented alternatives
(`firebase.readonly` / `cloud-platform.read-only` for reads, `firebase` / `cloud-platform` for writes) are reported for a
decision. The publisher's `firebase.hosting` scope is exercised for the first time only in a preview.

Note on routes: the code uses the project-qualified `projects/{project}/sites/{site}/…` routes of the discovery document;
the method-level pages that could be retrieved document the `sites/{site}/…` family. The canary exercises the
project-qualified reads first.

Mint a token (operator, own gcloud configuration; the token stays in a variable and is never printed or typed into chat):

```powershell
$body = @{ scope = @('https://www.googleapis.com/auth/firebase.hosting','https://www.googleapis.com/auth/userinfo.email'); lifetime = '900s' } | ConvertTo-Json
$r = Invoke-RestMethod -Method Post -Uri 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/qr-hosting-publisher-20261109@ais-channel-os.iam.gserviceaccount.com:generateAccessToken' `
       -Headers @{ Authorization = "Bearer $(gcloud auth print-access-token)" } -ContentType 'application/json' -Body $body
$env:QR_PUBLISHER_TOKEN = $r.accessToken; Remove-Variable r
```

## The security boundary (read this)

The publisher service account needs `firebasehosting.sites.update`. **IAM cannot limit that permission to one site,
one channel or one path.** While the account is enabled and a token exists, that token could, in principle, change
anything on any Hosting site in the project. The restrictions in `scripts/lib/qrPublisher.mjs` (project, site, channel
names, `/qr/` only, plan hash, typed confirmation, provenance, no DELETE) are **application-level controls inside this
program, not an IAM boundary**. The real protections are: the account is disabled except during an approved window,
tokens last 15 minutes, no keys exist, only the operator can mint tokens, and every release is gated by a plan hash
that a person approved.

## Build provenance (mandatory, checked independently)

The publisher accepts only the **artifact zip** that GitHub recorded for a successful **push to `main`** run of
`.github/workflows/qr-build.yml`. Before anything is written it asks the public GitHub API and refuses unless:

- repository is `sanjug05/smart-qr-studio` **and** its immutable id is `1350465108`;
- the run is `push` on `main` (`refs/heads/main`), workflow file `.github/workflows/qr-build.yml` (workflow id `411795429`),
  status `completed`, conclusion `success`; the manifest's `runAttempt` equals the run's actual `run_attempt`;
- the run's head SHA equals the manifest's 40-character **source commit** (`GITHUB_SHA`), the manifest's run id agrees, and
  the commit is part of `main`;
- **trusted workflow:** the manifest's `workflowSha` (`GITHUB_WORKFLOW_SHA`, the commit of the workflow *file*) is a full
  40-character SHA, is the source commit or one of its ancestors, and `.github/workflows/qr-build.yml` fetched from GitHub
  **at the source commit and at the workflow revision** has the **reviewed Git blob SHA** pinned in
  `PROVENANCE.WORKFLOW_BLOB_SHA`. The two commits are *not* required to be equal: after later application commits the
  workflow file's revision is legitimately older. A deliberate workflow change makes builds ineligible until the pin is updated
  in a reviewed change (a test fails until then);
- the artifact `qr-release-<commit>` exists for that run, is not expired, GitHub's record says it came from this run id,
  this source commit, branch `main` and repository `1350465108` (head repository too; a missing value is a refusal), and
  GitHub's **SHA-256 digest equals the digest of the zip you downloaded**.

A hash stored inside the artifact proves nothing on its own and is never trusted by itself. Pull-request builds upload no
artifact, there is no manual trigger, and a manifest that claims a pull-request or manual event is refused. If GitHub
cannot be reached or answers anything unexpected, the publisher **refuses** (fail closed). The zip is read in memory with
a strict reader (no path traversal, CRC and size checked, no extra entries) and every file is checked against the manifest.
A re-run of a workflow changes `run_attempt`; an artifact from an earlier attempt is refused (rebuild with a new push).

## 1. Get the artifact

Open the `QR Build (CI only)` run that was triggered by the **push to `main`** for the commit to publish and download the
artifact `qr-release-<commit>` (a `.zip`). Do not unzip it and do not rebuild locally: the zip is the approved input.

## 2. Plan (read-only) — produces the hash a person approves

```powershell
node scripts/deploy-qr-hosting.mjs --mode preview --channel qr-pv-20261109-<id> --artifact-zip qr-release-<commit>.zip `
  --expected-live-version <current live version id> --plan-only --plan-out plan.json
```

The plan lists the live version, the hashes of every non-`/qr` file and of the non-`/qr` configuration, the artifact and
its provenance, the exact `/qr` changes, and `nonQrChanges: 0`. It ends with `PLAN_SHA256=<hash>`.

## 3. Preview (single-use channel)

Same command without `--plan-only`, plus `--plan-sha256 <hash>`. A preview channel must be named
`qr-pv-<yyyymmdd>-<id>`, is created fresh, expires after 48 hours, and is never reused. The old `qr-preview` channel is
protected. A preview URL is public and shows a copy of the **whole** site: do not share it.

## 4. Live (exactly one release, after the preview was verified)

```powershell
node scripts/deploy-qr-hosting.mjs --mode live --artifact-zip qr-release-<commit>.zip `
  --expected-live-version <current live id> --tested-version <the verified preview version id> `
  --plan-only --plan-out plan-live.json
# then repeat without --plan-only and add:
#   --plan-sha256 <live plan hash> --confirm PUBLISH-CLEAN-QR-TO-LIVE `
#   --receipt-out "$HOME\Downloads\QR-release-records\<name>.json" --operator <who>
```

Live mode refuses unless the new version is byte-identical (files and configuration) to the tested preview version.

## 5. Roll back

```powershell
node scripts/deploy-qr-hosting.mjs --mode rollback --target-version <previous version id> `
  --expected-live-version <current live id> --confirm ROLLBACK-QR-TO-<previous version id>
```

The only write is re-releasing that exact earlier, finalized version.

## 6. Audit (read-only, dedicated identity, explicit windows only)

The audit accepts **only** the dedicated read-only Hosting service account (`qr-canary-20261109@…`) with a token of scope
`https://www.googleapis.com/auth/firebase.hosting.readonly` (plus identity scopes only) and 120–900 s left. A personal or Owner token, a write scope, or any
broader scope is refused. The account stays disabled; the Owner enables it only for an explicitly authorised audit window
and disables it afterwards.

```powershell
$env:QR_AUDIT_TOKEN = '<900 s token, scope firebase.hosting.readonly + userinfo.email; never typed into chat>'
node scripts/audit-qr-live.mjs --receipt "$HOME\Downloads\QR-release-records\<name>.json"
Remove-Item Env:QR_AUDIT_TOKEN
```

It makes GET requests only, never prints the token, and reports every file or configuration difference between live now
and the last receipt, flagging anything outside `/qr`.

Always clear tokens afterwards: `Remove-Item Env:QR_PUBLISHER_TOKEN`.
