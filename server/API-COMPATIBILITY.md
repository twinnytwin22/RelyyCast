# Unified Server API Compatibility (Locked During Merge)

This contract is intentionally fixed while migrating clients from split servers to `server/server.mjs`.

## Pairing

- `POST /api/pair/start` (canonical)
- `POST /api/desktop/pair/start` (legacy alias)

- `POST /api/pair/approve` (canonical)
- `POST /api/desktop/pair/approve` (legacy alias)

- `GET /api/pair/status?pairingCode=RLY-XXXXXX` (canonical)
- `POST /api/pair/status` with `{ pairingCode }` (compat)
- `GET /api/desktop/pair/status?pairingCode=RLY-XXXXXX` (legacy alias)
- `POST /api/desktop/pair/status` with `{ pairingCode }` (legacy alias)

## Heartbeat

- `POST /api/heartbeat` (canonical)
- `POST /api/desktop/heartbeat` (legacy alias)

- `GET /api/heartbeat?agentId=...` (canonical)
- `GET /api/desktop/heartbeat?agentId=...` (legacy alias)

## Stream Diagnostics / Metadata

- `GET /health`
- `GET /mounts` (canonical)
- `GET /api/mounts` (legacy alias)
- `GET /hls/<relayPath>/index.m3u8` (HLS passthrough proxy)
- `POST /metadata?mount=/live.mp3&song=Artist+-+Track` (canonical)
- `GET /metadata?...` (compat)
- `POST /admin/metadata?...` (legacy alias)
- `GET /admin/metadata?...` (legacy alias)

## Config

- `GET /api/config`
- `POST /api/config`
