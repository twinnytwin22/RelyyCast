# RelyyCast — Troubleshooting Guide

## Reading the Control Panel

Before diagnosing issues, check the status tiles in the **Control** tab:

| Tile | Value | Meaning |
|---|---|---|
| **Runtime** | `STARTING` | Processes are launching |
| **Runtime** | `RUNNING` | All processes healthy |
| **Runtime** | `ERROR` | One or more processes failed — check the status bar |
| **Cloudflare** | `PENDING-CONSENT` | Waiting for user to click Connect |
| **Cloudflare** | `LOGIN-REQUIRED` | cloudflared needs browser authentication |
| **Cloudflare** | `PROVISIONING` | Setup in progress — wait |
| **Cloudflare** | `READY` | Tunnel active and public URL live |
| **Cloudflare** | `ERROR` | Tunnel setup failed — see error message |
| **Relay** | `Ready` | MediaMTX has an active ingest path |
| **Relay** | `Pending` | MediaMTX is running but no source is feeding it yet |

The footer status bar shows the runtime phase, relay state, and Cloudflare status at a glance.

---

## Process Issues

### FFmpeg not starting

**Symptom:** Runtime stays at `STARTING`, Relay shows `Pending`, no audio reaches the stream.

**Causes and fixes:**

- **Binary not found.** Open **Settings** and set the full path to your FFmpeg binary (e.g. `C:\tools\ffmpeg\bin\ffmpeg.exe` or `/usr/local/bin/ffmpeg`). Click **Save Settings**.
- **Input URL unreachable.** The **Input URL** in Settings must be a live, accessible stream. If you are using the default `http://127.0.0.1:4850/live.mp3`, confirm that source is running. Test by opening the URL in a browser.
- **Port conflict on 1935.** Another application may be using the RTMP port. Stop any other RTMP server before launching RelyyCast.

---

### MediaMTX not starting

**Symptom:** Relay tile stays `Pending`, no HLS endpoint.

**Causes and fixes:**

- **Binary not found.** Set the full path in **Settings → MediaMTX Path**. Download from https://github.com/bluenviron/mediamtx/releases.
- **Port conflict on 8888 or 9997.** Check if another process is using these ports:
  - **Windows:** `netstat -ano | findstr :8888`
  - **macOS/Linux:** `lsof -i :8888`
  Stop the conflicting process, then click **Retry** or restart the app.
- **Custom config file error.** If you set a custom **MediaMTX Config** path, verify the file exists and is valid YAML. Leave the field blank to use the built-in default.

---

### MP3 Helper not starting

**Symptom:** Listeners shows `0`, stream URL `http://127.0.0.1:8177/live.mp3` returns an error.

**Causes and fixes:**

- **Port 8177 already in use.** Another process is occupying the MP3 helper port. Find and stop it:
  - **Windows:** `netstat -ano | findstr :8177`
  - **macOS/Linux:** `lsof -i :8177`

---

### Processes restart in a loop

**Symptom:** Status flickers between `STARTING` and `RUNNING`, processes restart repeatedly.

**Causes and fixes:**

- The process is crashing and triggering automatic restart with backoff (2–3 seconds for most processes, 10 seconds for cloudflared).
- Check that your FFmpeg **Input URL** is live and accessible.
- Verify binary paths in Settings are correct and the binaries are executable.
- Check that all required ports (1935, 8177, 8888, 9997) are free.

---

## Cloudflare Issues

### Status stays at PENDING-CONSENT

This is the initial state. Click **Connect** in the Control tab to begin setup. If you do not want a public URL, click **Skip**.

---

### Status stays at LOGIN-REQUIRED or browser does not open

**Symptom:** Clicked Connect, status shows `LOGIN-REQUIRED`, no browser window appeared.

**Causes and fixes:**

- **cloudflared binary not found.** The app cannot open the browser auth flow without `cloudflared`. Check:
  1. Download cloudflared from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
  2. Place it in the canonical inventory path:
    - `binaries/cloudflared/win/cloudflared.exe` (Windows)
    - `binaries/cloudflared/mac/cloudflared` (macOS)
  3. Run `npm run deps:preflight` and `npm run deps:stage`.
  4. Or set the explicit path via **Settings → (advanced)** or the `RELYY_CLOUDFLARED_PATH` environment variable.
- **Browser blocked by OS.** Some OS security settings prevent apps from opening browser windows. If the browser did not open, run `cloudflared tunnel login` manually in a terminal. Once authentication completes, click **Retry** in the app.

---

### Login completes in browser but status stays at LOGIN-REQUIRED

**Symptom:** You authorized the app in the browser, but Cloudflare status did not advance.

**Cause:** The `cert.pem` file was not found after authentication completed.

**Fix:**

1. Check if `cert.pem` was created by cloudflared in its default location:
   - **Windows:** `%USERPROFILE%\.cloudflared\cert.pem` or `%APPDATA%\cloudflared\cert.pem`
   - **macOS/Linux:** `~/.cloudflared/cert.pem`
2. If found there, click **Retry** in the app. The app will copy it to the app data directory automatically.
3. If not found, the browser auth may not have completed. Re-click **Connect** to retry the login flow.

---

### Status shows ERROR — "cloudflared binary not found"

The app searched these locations and found nothing:

| Location | Platform |
|---|---|
| `binaries/cloudflared/win/cloudflared.exe` | Windows |
| `binaries/cloudflared/mac/cloudflared` | macOS |
| `build/bin/cloudflared[.exe]` | Any |
| System `PATH` | Any |

**Fix:** Download cloudflared and place it in the canonical `binaries/` path, run `npm run deps:preflight && npm run deps:stage`, or set `RELYY_CLOUDFLARED_PATH` before launching the app. Then click **Retry**.

---

### Status shows ERROR — "Custom Domain mode requires a Cloudflare-managed hostname"

You are in Custom Domain mode but the **Hostname** field is empty.

**Fix:** Enter your hostname (e.g. `radio.yourdomain.com`) in the Hostname field, click **Save**, then click **Connect**. If you have not yet set up a Cloudflare tunnel, click **Setup Guide** to walk through the process.

---

### Status shows ERROR — tunnel create or credentials not found

**Symptom:** Auth completed, but setup failed with a tunnel creation or credentials error.

**Causes and fixes:**

- **Tunnel name contains invalid characters.** Tunnel names are automatically sanitized to lowercase alphanumeric + hyphens. Avoid special characters.
- **Cloudflare account quota.** Free Cloudflare accounts support up to 5 named tunnels. Delete unused tunnels at https://one.dash.cloudflare.com → Networks → Tunnels.
- **Credential file (.json) not found.** After tunnel creation, `cloudflared` writes a credentials JSON to `~/.cloudflared/<tunnel-id>.json`. The app copies this to its app data directory. If the copy fails (permissions issue), copy the file manually from `~/.cloudflared/` to the app data directory.

Click **Retry** after resolving the issue.

---

### Status shows ERROR — DNS route failed

**Symptom:** Tunnel was created but DNS routing failed.

**Causes and fixes:**

- **Hostname not in your Cloudflare account.** The hostname you entered must be a subdomain of a domain managed by Cloudflare DNS. Verify at https://dash.cloudflare.com that your domain is listed and its nameservers point to Cloudflare.
- **Zone not active.** If you just added your domain to Cloudflare, DNS propagation may still be pending (up to 48 hours). Wait and retry.
- **API permission error.** The `cert.pem` credential may belong to a Cloudflare account that does not own the domain. Re-run `cloudflared tunnel login` to re-authenticate against the correct account, then click **Retry**.

---

### Tunnel is READY but public URL is not accessible

**Symptom:** Cloudflare status is `READY`, URL appears in the panel, but opening it returns an error.

**Causes and fixes:**

- **MP3 Helper not running.** The tunnel forwards traffic to `localhost:8177`. If the MP3 helper process is not running, requests will fail. Check the **Runtime** tile — it must show `RUNNING`.
- **DNS not propagated.** After a new DNS route is created, it can take a few minutes to propagate. Wait and refresh.
- **Hostname mismatch.** The Hostname field must exactly match the public hostname you configured in the Cloudflare tunnel wizard. Copy it directly from the tunnel's public hostname configuration.
- **Temporary URL has changed.** Temporary (`trycloudflare.com`) URLs change each time you reconnect. Always copy the URL fresh from the **Stream** panel after connecting.

---

## Stream Not Playing

### MP3 stream opens but is silent

**Symptom:** Browser connects, no audio plays.

**Causes and fixes:**

- **No audio reaching FFmpeg.** Check that the **Input URL** in Settings is a live stream. Open it directly in a browser to confirm it is serving audio.
- **FFmpeg Ingest process crashed.** Restart the app. If the crash recurs, verify the Input URL is accessible from the machine running RelyyCast.

---

### MP3 URL works locally but not from the public Cloudflare URL

**Symptom:** `http://127.0.0.1:8177/live.mp3` plays fine, but the Cloudflare URL does not.

**Fix:** Confirm Cloudflare tunnel service is set to `HTTP → localhost:8177` (not `HTTPS`). The MP3 helper runs plain HTTP on port 8177. Check the tunnel configuration in the Cloudflare Zero Trust dashboard.

---

### HLS stream not loading

**Symptom:** `http://127.0.0.1:8888/live/index.m3u8` returns a 404.

**Causes and fixes:**

- **MediaMTX not running.** Check the Runtime status.
- **Relay Path mismatch.** The HLS URL uses the **Relay Path** from Settings (default: `live`). If you changed it, the URL changes to `http://127.0.0.1:8888/<your-path>/index.m3u8`.
- **No active ingest.** MediaMTX creates the HLS path only when FFmpeg is actively pushing data. Wait for FFmpeg Ingest to start and push a few seconds of data.

---

## Settings Not Saving

**Symptom:** Changes in the Settings tab revert after clicking away, or the status bar shows "Save failed."

**Causes and fixes:**

- **Runtime not running.** Settings are sent to the runtime process to apply. If the runtime is not started, changes are saved to `localStorage` only and applied on next restart.
- **Runtime IPC error.** If the error message mentions IPC or communication, restart the app and try again.

---

## App Does Not Start

### Window opens blank or white

**Cause:** The Vite dev server is not running (dev mode) or the build is stale.

- **Dev mode:** Run `npm run dev` in the project directory before launching.
- **Production build:** Run `npm run build` to regenerate the build artifacts.

### Neutralino binary not found

Run `npm run neutralino:update` to download the correct Neutralino runtime binary for your platform.

---

## Collecting Debug Information

If you need to report an issue:

1. Open DevTools in the app window (F12 or Ctrl+Shift+I — enabled in development builds).
2. Check the **Console** tab for error messages from the runtime orchestrator — look for lines prefixed with `[AppWindowChrome]` or `[RuntimeOrchestrator]`.
3. The runtime state file at `<app-data>/relyycast/runtime-state.json` contains the last known state of all processes and Cloudflare onboarding. Include this file when reporting issues.
4. On macOS/Linux, run `cloudflared --version` in a terminal to confirm cloudflared is installed and executable.

---

## Dependency Preflight

Before local runtime, build, or packaging commands on a new device:

1. Place host binaries in the canonical `binaries/` inventory paths.
2. Optionally migrate from legacy repo locations with `npm run deps:seed`.
3. Run `npm run deps:preflight`.
4. Run `npm run deps:stage`.

If Bun is missing, preflight will print a global install command. Bun is required for MP3 helper development workflows.

Platform-specific preflight command examples:

- macOS/Linux:

```bash
npm run deps:seed
npm run deps:preflight
npm run deps:stage
```

- Windows (PowerShell):

```powershell
npm run deps:seed
npm run deps:preflight
npm run deps:stage
```

---

## Resetting to Defaults

To fully reset RelyyCast:

1. Click **Skip** to stop any active Cloudflare tunnel.
2. Close the app.
3. Delete the app data directory:
   - **Windows:** `%APPDATA%\relyycast\` or `%LOCALAPPDATA%\relyycast\`
   - **macOS:** `~/Library/Application Support/relyycast/`
   - **Linux:** `~/.config/relyycast/`
4. Clear `localStorage` for the app (open DevTools → Application → Local Storage → clear all).
5. Relaunch the app.

This removes all Cloudflare artifacts, runtime state, and saved settings. You will need to re-authenticate cloudflared and re-enter your settings.
