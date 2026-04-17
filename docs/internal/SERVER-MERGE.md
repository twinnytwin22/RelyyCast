# RelyyCast — Server Merge Plan

## Goal

Collapse 4 running processes down to 2:

| Before | After |
|---|---|
| `npm run dev` (Vite, port 3000) | `npm run dev` (Vite, port 3000) |
| `npm run api:dev` (control-plane, port 8787) | `npm run server:dev` (unified, port 8177) |
| `npm run stream:dev` (fan-out, port 8177) | — merged — |
| `npm run stream:ingest` (FFmpeg source) | — merged — |

All server logic lives in one file: `server/server.mjs`.

---

## Package Scripts (after cleanup)

```json
"dev":               "vite --host 127.0.0.1 --port 3000",
"server:dev":        "node server/server.mjs",
"stack:dev":         "concurrently -k -n WEB,SERVER -c cyan,yellow \"npm:dev\" \"npm:server:dev\"",
"build":             "vite build",
"start":             "vite preview --host 127.0.0.1 --port 3000",
"lint":              "eslint .",
"neutralino:run":    "npx neu run",
"neutralino:update": "npx neu update",
"dev:app":           "node scripts/dev-app.mjs"
```

---

## `server/server.mjs` — Sections

### 1. Config Management
- Read `.tmp/relyy-config.json` on startup; create with defaults if missing
- Env vars override file values at runtime
- Default config:
  ```json
  {
    "inputUrl":    "http://127.0.0.1:4850/live.mp3",
    "stationName": "RelyyCast Dev Stream",
    "genre":       "Various",
    "description": "Local FFmpeg test source",
    "bitrate":     "128k",
    "ffmpegPath":  ""
  }
  ```

### 2. Stream Fan-out (from `local-stream-server.mjs`)
Keep:
- `mountMap` — per-mount state (source, listeners, metadata, stats)
- `handleSource()` — accepts `SOURCE` HTTP method
- `handleListener()` — `GET` with ICY metadata injection
- `fanOutChunkToMount()` — backpressure-aware
- `buildIcyMetadataBlock()` — ICY inline metadata
- `handleHealth()` — `GET /health`
- `handleMountListing()` — `GET /mounts`
- `handleMetadataUpdate()` — `POST /metadata`
- CORS headers

Remove:
- `streamState` global (redundant)
- `handleLegacyIngest` / `POST /ingest` (nothing calls it)
- All relay code (`connectRelay`, `relayReq`, etc.)

### 3. Control-Plane API (ported from `lib/server/desktop-api.ts` + `desktop-agent-store.ts`)
Endpoints:
- `POST /api/pair/start` — generate pairing code (`RLY-XXXXXX`)
- `POST /api/pair/approve` — approve pending pairing
- `GET  /api/pair/status` — poll pairing status
- `POST /api/heartbeat` — upsert agent heartbeat
- `GET  /api/heartbeat` — get last heartbeat

In-memory store (no external dep):
- `PAIRING_TTL_MS = 5 * 60 * 1000`
- Codes: `RLY-` + 6 hex chars via `crypto.randomBytes(3)`

### 4. Config API
- `GET  /api/config` — return current config JSON
- `POST /api/config` — merge, save to `.tmp/relyy-config.json`, restart FFmpeg

### 5. FFmpeg Lifecycle
- `resolveFfmpegPath()` — checks env vars, Windows candidates, falls back to PATH
- `buildFfmpegArgs(config)` — relay mode only, pulls from `config.inputUrl`
- Self-ingest: FFmpeg stdout → `SOURCE` push to `http://127.0.0.1:8177/live.mp3`
- Auto-restart on non-zero exit with **2-second backoff**
- Clean kill on `SIGINT`

---

## Files to Delete

| File | Reason |
|---|---|
| `scripts/local-stream-server.mjs` | Merged into `server/server.mjs` |
| `scripts/ffmpeg-to-stream.mjs` | Merged into `server/server.mjs` |
| `server/control-plane-server.mjs` | Replaced by merged server |
| `lib/server/desktop-api.ts` | Ported to JS in merged server |
| `lib/server/desktop-agent-store.ts` | Ported to JS in merged server |
| `lib/` directory | Empty after above |

---

## Files to Modify

### `vite.config.ts`
- Remove `desktopApiPlugin` import and plugin registration
- Result: `plugins: [react()]`

### `components/agent-operations-panel.tsx`
- `VITE_CONTROL_PLANE_URL ?? "http://127.0.0.1:8787"` → `VITE_SERVER_URL ?? "http://127.0.0.1:8177"`

### `components/station-console.tsx`
- `VITE_STREAM_ORIGIN_URL ?? "http://127.0.0.1:8177"` → `VITE_SERVER_URL ?? "http://127.0.0.1:8177"`
- **Domain tab → Settings tab**: replace static placeholder rows with editable config fields
  - Fields: Input URL, Station Name, Genre, Description, Bitrate, FFmpeg Path
  - Load: read `localStorage` first, then sync from `GET /api/config`
  - Save: write `localStorage` + `POST /api/config`

---

## Config Flow

```
Settings tab (UI)
  │
  ├── localStorage  ←── instant persistence across reloads
  │
  └── POST /api/config ──→ .tmp/relyy-config.json ──→ FFmpeg restart
               ↑
         GET /api/config  (sync on tab load)
```

---

## Security

- All listeners bind to `127.0.0.1` only — never `0.0.0.0`
- `.tmp/` is gitignored — config file stays off VCS
- No auth needed on loopback-only desktop endpoints
