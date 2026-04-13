# RelyyCast

RelyyCast is an operator-focused control plane with a desktop streaming agent architecture.

This repo currently includes:

- Vite + React UI shell
- Desktop pairing + heartbeat API scaffolds
- Standalone control-plane server scaffold
- Local MP3 stream origin scaffold

## Development commands

Install dependencies:

```bash
npm install
```

Run UI + standalone API + stream origin together:

```bash
npm run stack:dev
```

Run pieces independently:

```bash
npm run dev         # Vite UI on :3000
npm run api:dev     # standalone control-plane on :8787
npm run stream:dev  # local stream origin on :8177
npm run stream:ingest:tone # ffmpeg tone generator into a mount (default /live.mp3)
npm run app:view    # open :3000 in app-style window (Edge/Chrome app mode on Windows)
npm run dev:app     # run app-style view; reuses existing :3000 dev server if already running
npm run neutralino:update # download Neutralino runtime binary
npm run dev:neutralino    # run real Neutralino native window (frameless config)
npm run neutralino:build   # package the Neutralino app using the staged runtime assets
```

Build:

```bash
npm run build
```

`npm run build` now stages MediaMTX into `build/mediamtx/...` so the packaged app resources carry the repo-local relay binary and config for the current platform.

Lint:

```bash
npm run lint
```

## Control-plane URL for UI

The Agent tab in the UI calls the standalone control-plane server using:

- `VITE_CONTROL_PLANE_URL` (defaults to `http://127.0.0.1:8787`)

Example:

```bash
set VITE_CONTROL_PLANE_URL=http://127.0.0.1:8787
npm run dev
```

Optional stream origin URL override for the UI:

```bash
set VITE_STREAM_ORIGIN_URL=http://127.0.0.1:8177
npm run dev
```

## Current server endpoints

Unified server (`npm run server:dev`):

- `GET /health` (aggregated relay + ingest + mp3 bridge status)
- `GET /api/config`
- `POST /api/config`
- `GET /api/mounts`
- `GET|HEAD /live.mp3` (MP3 compatibility endpoint)
- `GET /hls/<relayPath>/index.m3u8` (HLS proxy passthrough)
- `SOURCE|PUT|POST /<mount>` (source publishing into local MP3 fanout)
- `GET|POST /admin/metadata?mount=/live.mp3&song=Artist+-+Track`
- `POST /api/pair/start` + legacy `/api/desktop/pair/start`
- `POST /api/pair/approve` + legacy `/api/desktop/pair/approve`
- `GET|POST /api/pair/status` + legacy `/api/desktop/pair/status`
- `POST /api/heartbeat` + legacy `/api/desktop/heartbeat`
- `GET /api/heartbeat?agentId=...` + legacy `/api/desktop/heartbeat?agentId=...`

Media relay process model:

- `mediamtx` is managed as a child process by `server/server.mjs`
- By default it resolves repo-local assets first: `mediamtx/win/mediamtx.exe` on Windows, `mediamtx/mac/mediamtx` on macOS, and `mediamtx/mediamtx.yml` for config
- Built app resources stage the same assets under `build/mediamtx/...` during `npm run build`
- FFmpeg ingest path: `config.inputUrl` -> `rtmp://127.0.0.1:1935/<relayPath>`
- FFmpeg MP3 bridge path: `rtmp://127.0.0.1:1935/<relayPath>` -> `SOURCE http://127.0.0.1:8177/live.mp3`

Media relay environment overrides:

- `RELYY_MEDIAMTX_PATH`
- `RELYY_MEDIAMTX_CONFIG`
- `RELYY_MEDIAMTX_RTMP_URL`
- `RELYY_MEDIAMTX_HLS_ORIGIN`
