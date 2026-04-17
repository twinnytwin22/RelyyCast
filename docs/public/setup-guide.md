# RelyyCast — Setup Guide

## Overview

RelyyCast is a desktop control panel that manages a local audio streaming stack. It coordinates five background processes — an MP3 helper server, a MediaMTX relay, two FFmpeg pipelines, and (optionally) a Cloudflare tunnel — and exposes your stream as a public MP3 URL.

---

## Prerequisites

Install these before launching RelyyCast. The app will not function without them.

| Dependency | Required for | Where to get |
|---|---|---|
| **FFmpeg** | Ingest + MP3 transcoding | https://ffmpeg.org/download.html |
| **MediaMTX** | HLS relay | https://github.com/bluenviron/mediamtx/releases |
| **cloudflared** | Public URL (optional) | https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ |

> **cloudflared is optional.** The app runs in local-only mode until you explicitly connect Cloudflare.

After downloading, note the full path to each binary — you will enter these in the Settings tab.

---

## First Launch

1. Open RelyyCast. The app window is fixed at 1024 × 500 px.
2. The runtime starts immediately and begins launching background processes in order:
   - MP3 Helper → MediaMTX → FFmpeg Ingest → FFmpeg MP3 Bridge → Cloudflared (if enabled)
3. The **Control** tab shows live status. The **Runtime** tile will change from `STARTING` to `RUNNING` once all processes are healthy.
4. Cloudflare starts in **pending-consent** mode — nothing connects to the internet until you explicitly click **Connect**.

---

## Configuring Settings

Open the **Settings** tab to configure paths and stream metadata.

| Field | Description | Default |
|---|---|---|
| **Input URL** | Source stream that FFmpeg pulls from | `http://127.0.0.1:4850/live.mp3` |
| **Station Name** | Icecast/Shoutcast stream name | `RelyyCast Dev Stream` |
| **Genre** | Stream genre metadata | `Various` |
| **Description** | Stream description metadata | — |
| **Bitrate** | MP3 output bitrate | `128k` |
| **Relay Path** | MediaMTX path name | `live` |
| **FFmpeg Path** | Full path to the ffmpeg binary | *(auto-detect)* |
| **MediaMTX Path** | Full path to the mediamtx binary | *(auto-detect)* |
| **MediaMTX Config** | Full path to a custom mediamtx config file | *(built-in default)* |

After making changes, click **Save Settings**. Changes take effect on the next process restart.

### Input URL

The Input URL is the audio source RelyyCast re-streams. This can be:

- A local FFmpeg-generated test stream (`http://127.0.0.1:4850/live.mp3`)
- Any accessible HTTP/HTTPS MP3 stream
- A local file path passed to FFmpeg

### Binary Paths

If FFmpeg or MediaMTX are not on your system `PATH`, enter their absolute paths:

- **Windows:** `C:\tools\ffmpeg\bin\ffmpeg.exe`
- **macOS/Linux:** `/usr/local/bin/ffmpeg`

Leave blank to use the system `PATH`.

---

## Ports Used

RelyyCast reserves the following local ports. Ensure nothing else is using them before launch.

| Port | Service | Description |
|---|---|---|
| `8177` | MP3 Helper | HTTP stream server. Your MP3 URL: `http://127.0.0.1:8177/live.mp3` |
| `8888` | MediaMTX | HLS endpoint: `http://127.0.0.1:8888/live/index.m3u8` |
| `1935` | MediaMTX | RTMP ingest from FFmpeg |
| `9997` | MediaMTX | Internal control API (health checks) |

---

## Connecting Cloudflare (Temporary URL)

The quickest way to get a public URL. No Cloudflare account or domain is required.

1. In the **Control** tab, make sure the mode pill says **Temp URL**.
2. Click **Connect**.
3. The app starts a `trycloudflare.com` tunnel. The public URL appears in the **Stream** panel on the right.
4. Copy the MP3 URL using the **Copy** button next to the MP3 row.

> Temporary URLs change every time you reconnect. Use a custom domain for a stable address.

---

## Connecting Cloudflare (Custom Domain)

For a stable URL on your own domain. Requires a Cloudflare account and a domain managed by Cloudflare DNS.

### Before you begin

Complete setup in the Cloudflare dashboard first. Click **Setup Guide** (visible when Custom Domain mode is active) for an in-app walkthrough with direct links to the correct dashboard pages. The steps are:

1. Add your domain to Cloudflare at https://dash.cloudflare.com
2. Open Zero Trust at https://one.dash.cloudflare.com → **Networks → Tunnels → Create a tunnel**
3. Choose **Cloudflared** as the connector type
4. Name your tunnel (e.g. `relyycast-local`) — this is your **Tunnel Name**
5. Add a public hostname (e.g. `radio.yourdomain.com`) pointing to **HTTP → localhost:8177** — this is your **Hostname**

### Connecting

1. Switch the mode pill to **Custom Domain**.
2. Enter your **Hostname** (e.g. `radio.yourdomain.com`) and **Tunnel Name** (e.g. `relyycast-local`).
3. Click **Save**, then click **Connect**.
4. Your browser opens for Cloudflare authentication (`cloudflared tunnel login`). Authorize the app in the browser.
5. The app waits for the `cert.pem` credential file, creates the tunnel, routes DNS, and starts `cloudflared`. Status changes to **READY**.

### What gets stored locally

RelyyCast stores Cloudflare artifacts in its app data directory — no tokens leave your machine:

- `cert.pem` — your Cloudflare origin certificate
- `<tunnel-id>.json` — tunnel credential file
- `config.yml` — generated cloudflared config
- `runtime-state.json` — persisted runtime state (survives restarts)

On relaunch, existing artifacts are reused and `cloudflared` starts without requiring re-authentication.

---

## Verifying Your Stream

Once the runtime is `RUNNING` and Cloudflare is `READY`:

1. In the **Control** tab, the **Stream** section shows your MP3 and HLS URLs.
2. Click **Open MP3** to test playback in your browser.
3. The **Listeners** tile updates when clients connect to the MP3 stream.
4. The **Relay** tile shows `Ready` when MediaMTX has an active ingest path.

### Local stream URL

```
http://127.0.0.1:8177/live.mp3
```

### Public stream URL (Cloudflare)

```
https://<your-hostname-or-trycloudflare.com>/live.mp3
```

---

## Environment Variable Overrides

Advanced users can override settings via environment variables before launching the app.

| Variable | Overrides |
|---|---|
| `RELYY_CLOUDFLARE_TUNNEL_NAME` | Tunnel Name field |
| `RELYY_CLOUDFLARE_HOSTNAME` | Hostname field |
| `RELYY_CLOUDFLARED_PATH` | Path to cloudflared binary |

---

## Skipping Cloudflare

If you do not need a public URL, click **Skip** in the Control tab. The app continues running in local-only mode with no Cloudflare connection attempts. You can connect at any time later by clicking **Connect**.
