# RelyyCast

RelyyCast is a Neutralino desktop control plane for a local relay stack.

This repo currently includes:

- Vite + React UI shell
- Neutralino runtime orchestration
- MediaMTX relay assets
- Bun MP3 helper source + build pipeline
- Cloudflare tunnel onboarding/runtime wiring

Setup guide for new machines:

- `docs/new-machine-setup.md`

Consumer troubleshooting guide (no code access required):

- `docs/consumer-troubleshooting-guide.md`

## Canonical runtime dependencies

Runtime dependency binaries are sourced from a single canonical inventory folder:

- `binaries/`

This folder structure is committed to git, but binary payloads are not.

For host setup, place binaries in these paths:

- `binaries/mediamtx/mediamtx.yml`
- macOS:
	- `binaries/mediamtx/mac/mediamtx`
	- `binaries/cloudflared/mac/cloudflared`
	- `binaries/mp3-helper/mac/relyy-mp3-helper` (optional)
- Windows:
	- `binaries/mediamtx/win/mediamtx.exe`
	- `binaries/cloudflared/win/cloudflared.exe`
	- `binaries/mp3-helper/win/relyy-mp3-helper.exe` (optional)

Before running app/build/packaging commands:

```bash
npm run deps:seed
npm run deps:preflight
npm run deps:stage
```

`deps:preflight` also checks for global Bun and prints install instructions if missing.

### macOS developer notes

- Recommended bootstrap sequence:

```bash
npm install
npm run deps:seed
npm run deps:preflight
npm run deps:stage
npm run neutralino:run
```

- Quick checks:

```bash
ls -l binaries/mediamtx/mac/mediamtx binaries/cloudflared/mac/cloudflared
ls -l build/mediamtx/mac/mediamtx build/bin/cloudflared
```

### Windows developer notes

- Recommended bootstrap sequence (PowerShell):

```powershell
npm install
npm run deps:seed
npm run deps:preflight
npm run deps:stage
npm run neutralino:run
```

- Quick checks (PowerShell):

```powershell
Get-Item binaries/mediamtx/win/mediamtx.exe, binaries/cloudflared/win/cloudflared.exe
Get-Item build/mediamtx/win/mediamtx.exe, build/bin/cloudflared.exe
```

## Cloudflare onboarding behavior

Cloudflare setup is consent-first and local-first:

- On first launch, runtime starts local MediaMTX + FFmpeg + Bun helper immediately.
- Cloudflare remains in `pending-consent` until the user explicitly clicks **Connect Cloudflare** in the Runtime panel.
- Cloudflare access mode is explicit in Settings: **Temporary URL** for `trycloudflare.com`, or **Custom Domain** for a Cloudflare-managed hostname.
- If no Cloudflare hostname is configured yet, that same action starts a temporary `trycloudflare.com` URL instead of forcing named-tunnel login.
- If the user clicks **Skip for now**, runtime stays in local mode with no repeated login popups.
- If login/provisioning fails, runtime surfaces actionable status and supports **Retry Cloudflare setup**.
- After onboarding completes once, restart/relaunch reuses local artifacts and starts `cloudflared` without re-consent.

Persisted Cloudflare artifacts are local app-data/runtime files only:

- `cert.pem`
- tunnel credentials JSON (`<tunnel-id>.json`)
- generated `config.yml`
- runtime metadata (`runtime-state.json`)

This pass does not capture or persist Cloudflare account auth tokens beyond `cloudflared`'s normal local files.

## Development commands

Install dependencies:

```bash
npm install
```

Run the web UI (dev):

```bash
npm run dev
```

Run the Neutralino desktop shell:

```bash
npm run neutralino:run
```

Preflight runtime dependencies only:

```bash
npm run deps:preflight
```

Seed canonical `binaries/` inventory from legacy locations in this repo:

```bash
npm run deps:seed
```

Stage runtime dependencies from canonical inventory to `build/`:

```bash
npm run deps:stage
```

Update Neutralino runtime binary:

```bash
npm run neutralino:update
```

Build web assets + stage runtime assets:

```bash
npm run build
```

Build packaged Neutralino app:

```bash
npm run neutralino:build
```

Build Bun MP3 helper binaries:

```bash
npm run mp3-helper:build
npm run mp3-helper:build:all
```

Lint:

```bash
npm run lint
```

Run local preview of production build:

```bash
npm run start
```
