# RelyyCast

RelyyCast is a free, open-source desktop app that lets you broadcast a local RTMP stream to the internet — without port forwarding, a static IP, or a paid streaming service. It runs a local [MediaMTX](https://github.com/bluenviron/mediamtx) relay and punches a secure public URL through [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), giving you a shareable RTMP endpoint from any machine in seconds.

## Download

| Platform | Installer |
|---|---|
| macOS (Apple Silicon + Intel) | [RelyyCast.pkg](https://download.relyycast.com/installers/releases/0.1.0/macos/RelyyCast.pkg) |
| Windows 64-bit | [relyycast-setup.exe](https://download.relyycast.com/installers/releases/0.1.0/windows/relyycast-setup.exe) |

SHA-256 checksums are published alongside each release:

- `https://download.relyycast.com/installers/releases/0.1.0/macos/RelyyCast.pkg.sha256`
- `https://download.relyycast.com/installers/releases/0.1.0/windows/relyycast-setup.exe.sha256`

## How it works

1. Launch RelyyCast — a local MediaMTX relay starts immediately.
2. Point your encoder (OBS, ffmpeg, hardware encoder) at `rtmp://localhost:1935/live`.
3. Optionally connect Cloudflare to get a public `rtmps://` endpoint with a temporary `trycloudflare.com` URL or your own custom domain.
4. Share the URL with your audience or downstream ingest.

No cloud account is required for local relay. Cloudflare is opt-in and consent-first.

## Open source

RelyyCast is MIT-licensed. The Cloudflare Tunnel integration is the default, but the architecture is intentionally open — if you'd rather use [ngrok](https://ngrok.com), [Tailscale Funnel](https://tailscale.com/kb/1223/funnel), a self-hosted WireGuard gateway, or any other tunnel service, you can fork this repo and wire in your own provider. The relay core (MediaMTX config, process supervision, runtime orchestration) is fully independent of the tunnel layer.

The tunnel interface lives in:

- [`src/runtime/cloudflared-onboarding.ts`](src/runtime/cloudflared-onboarding.ts)
- [`src/runtime/orchestrator/runtime-launch-resolvers.ts`](src/runtime/orchestrator/runtime-launch-resolvers.ts)

## Update manifest

RelyyCast publishes a stable `latest.json` at the root of each platform path so apps and scripts can check for updates:

- `https://download.relyycast.com/installers/releases/macos/latest.json`
- `https://download.relyycast.com/installers/releases/windows/latest.json`

```json
{
  "product": "relyycast",
  "version": "0.1.0",
  "releaseDate": "2026-04-18",
  "platform": "macos",
  "fileName": "RelyyCast.pkg",
  "url": "https://download.relyycast.com/installers/releases/0.1.0/macos/RelyyCast.pkg",
  "sha256": "<hex>",
  "fileSizeBytes": 0
}
```

---

## Developer setup

### Prerequisites

- Node.js 20+
- macOS or Windows build host
- Runtime binaries in `binaries/` (see below)

### Canonical runtime dependencies

Binary payloads are not committed to git. Place them at:

| File | macOS | Windows |
|---|---|---|
| MediaMTX config | `binaries/mediamtx/mediamtx.yml` | same |
| MediaMTX binary | `binaries/mediamtx/mac/mediamtx` | `binaries/mediamtx/win/mediamtx.exe` |
| cloudflared binary | `binaries/cloudflared/mac/cloudflared` | `binaries/cloudflared/win/cloudflared.exe` |

### Bootstrap (macOS)

```bash
npm install
npm run deps:seed
npm run deps:preflight
npm run deps:stage
npm run neutralino:run
```

### Bootstrap (Windows / PowerShell)

```powershell
npm install
npm run deps:seed
npm run deps:preflight
npm run deps:stage
npm run neutralino:run
```

### Common commands

```bash
npm run dev                  # Vite dev server only
npm run neutralino:run       # Full desktop app (dev)
npm run build                # Build web assets + stage runtime deps
npm run neutralino:build     # Package Neutralino app
npm run installer:build      # Build platform installer (.pkg / .exe)
npm run release:upload:r2    # Upload release artifact + update latest.json
npm run deps:preflight       # Verify runtime binaries are present
npm run deps:seed            # Seed binaries/ from legacy locations
npm run deps:stage           # Stage binaries into build/
npm run ffmpeg:detect        # Check for FFmpeg on host
npm run lint                 # ESLint
```

### Release flow

```bash
npm run version:bump:decimal           # x.y.z -> x.y.(z+1)
npm run installer:build
npm run release:upload:r2
```

### Windows signing (installer:build)

`npm run installer:build` now supports Windows Authenticode signing in-flow.

Set one of these identity modes:

```bash
# Mode A: PFX file
WINDOWS_SIGN_CERT_FILE=C:\path\to\crib-llc-code-signing.pfx
WINDOWS_SIGN_CERT_PASSWORD=your_pfx_password

# Mode B: Windows cert store
WINDOWS_SIGN_SUBJECT_NAME=CRIB, LLC
# optional:
# WINDOWS_SIGN_CERT_SHA1=ABCDEF0123456789ABCDEF0123456789ABCDEF01
# WINDOWS_SIGN_USE_MACHINE_STORE=true
```

Optional controls:

```bash
WINDOWS_SIGNTOOL_PATH=C:\Program Files (x86)\Windows Kits\10\bin\x64\signtool.exe
WINDOWS_SIGN_TIMESTAMP_URL=http://timestamp.digicert.com
WINDOWS_SIGN_DIGEST=SHA256
```

Behavior:

- Signs `dist/relyycast/relyycast-win_x64.exe` before NSIS packaging.
- Signs `dist/relyycast-setup.exe` after NSIS packaging.
- Use `npm run installer:build:skip-sign` to force unsigned output.

The upload script pushes the installer, a `.sha256` checksum file, a versioned `manifest.json`, and an updated `latest.json` to the configured R2 bucket. Set these env vars (or add them to `.env.release.local`):

```
S3_ENDPOINT=
S3_BUCKET=
S3_KEY=
S3_SECRET=
S3_PREFIX=          # optional key prefix
S3_REGION=          # optional, defaults to auto
S3_PUBLIC_URL=      # public base URL for generated download links
```

### Cloudflare onboarding behavior

- On first launch, MediaMTX starts immediately in local-only mode.
- Cloudflare stays in `pending-consent` until the user clicks **Connect Cloudflare**.
- Mode is explicit in Settings: **Temporary URL** (`trycloudflare.com`) or **Custom Domain**.
- If the user clicks **Skip for now**, the app stays in local mode — no repeated prompts.
- After onboarding completes once, relaunch reuses local credentials without re-consent.

Persisted Cloudflare artifacts (stored in local app-data):

- `cert.pem`
- Tunnel credentials JSON (`<tunnel-id>.json`)
- Generated `config.yml`
- Runtime metadata (`runtime-state.json`)

No Cloudflare account tokens are captured beyond what `cloudflared` writes locally.
