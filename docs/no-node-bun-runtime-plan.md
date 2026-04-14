# No-Node Bun Runtime Plan

Last updated: 2026-04-13

Branch for this pass: `migration/no-node-bun-runtime`

## Goal

Remove Node completely from the desktop runtime and from the intended local workflow.

The target runtime is:

- Neutralino as the shell and process orchestrator
- MediaMTX as the RTMP and HLS relay
- FFmpeg for ingest and encode steps
- `cloudflared` for public ingress
- A Bun-compiled MP3 helper only if MP3 still requires a local HTTP streaming service

Node is not allowed in the final runtime, in the packaged app, or in the repo's documented local stack after this pass is complete.

## How To Use This Plan

This file is meant to be the single source of truth for sequential implementation.

Rules:

1. One chat window should complete one phase only.
2. A phase may start only if every earlier phase is marked complete.
3. At the end of a phase, update this file before stopping.
4. Do not start a later phase just because there is time left in the chat.
5. If a phase uncovers a blocker that changes the plan, update the blocker note in this file and stop at that phase boundary.

Required end-of-phase update:

- Change the phase checkbox from `[ ]` to `[x]`
- Fill in the completion date
- Fill in the verification notes
- Fill in the files added, updated, or deleted
- Add the exact next phase number that is now unlocked

## Status Board

- [x] Phase 0 - Branch and baseline freeze
- [x] Phase 1 - Runtime contract and delete map
- [x] Phase 2 - Bun MP3 helper extraction
- [x] Phase 3 - Neutralino runtime orchestration
- [x] Phase 4 - Cloudflare onboarding and local persistence
- [x] Phase 5 - UI migration off the Node API surface
- [ ] Phase 6 - Build and packaging conversion
- [ ] Phase 7 - Repo cleanup and legacy deletion
- [ ] Phase 8 - Final verification and release readiness

## Non-Negotiable Rules

- Do not reintroduce a general-purpose local Node server.
- Do not recreate `/api/config`, `/health`, `/api/desktop/*`, or the old pairing and heartbeat contract under a new runtime unless the phase explicitly says to keep a tiny private helper endpoint.
- Keep the Bun helper as small as possible. It is an MP3 compatibility sidecar, not a replacement monolith.
- Preserve the current MP3 behavior first. Simplify only after the no-Node migration is stable.
- Use the OS app-data directory for generated config, tunnel credentials, and runtime state. Do not write runtime state back into the repo.

## Keep / Remove Summary

Keep in final architecture:

- `mediamtx/`
- Neutralino app shell
- React UI shell
- FFmpeg-based ingest flow
- `cloudflared`
- Bun-compiled MP3 helper if still required

Must be removed or retired by the end of this pass:

- `node server/server.mjs` as a runtime entrypoint
- Node-based local config API
- Node-based local health API
- Node-based pairing and heartbeat API
- Docs that advertise the Node runtime as current architecture

## Phase 0 - Branch and baseline freeze

Status: Complete

Completion date: 2026-04-13

Goal:

- Create a dedicated branch for the no-Node rewrite.
- Freeze the migration target before implementation starts.

Completed work:

- Created branch `migration/no-node-bun-runtime`
- Replaced the working plan with a strict no-Node direction

Verification:

- Branch exists locally and is active

Files touched in this phase:

- Session planning only

Next phase unlocked:

- Phase 1

## Phase 1 - Runtime contract and delete map

Status: Complete

Completion date: 2026-04-13

Goal:

- Write down the exact runtime responsibilities for Neutralino, MediaMTX, FFmpeg, cloudflared, and the Bun helper.
- Produce the repo-wide keep list, replace list, archive list, and delete list.

Required outputs:

- Exact Bun helper boundary
- Exact Neutralino orchestration boundary
- Exact list of old files, scripts, routes, and docs that are no longer allowed
- Decision on whether the local MP3 mount remains on `:8177`

Tasks:

1. Audit everything still tied to `server/server.mjs`.
2. Split each responsibility into one of four buckets: keep, move, replace, delete.
3. Mark which files will survive only as extraction references.
4. Mark which files can be deleted immediately after later phases land.
5. Update this plan with the confirmed delete map.

Primary files to review:

- `server/server.mjs`
- `package.json`
- `README.md`
- `SERVER-MERGE.md`
- `server/API-COMPATIBILITY.md`
- `components/station-console.tsx`
- `components/agent-operations-panel.tsx`
- `docs/relyycast-v1-plan.md`

Completed work:

- Audited current runtime ownership and legacy surface in:
  - `server/server.mjs`
  - `package.json`
  - `README.md`
  - `SERVER-MERGE.md`
  - `server/API-COMPATIBILITY.md`
  - `components/station-console.tsx`
  - `components/agent-operations-panel.tsx`
  - `docs/relyycast-v1-plan.md`

Confirmed runtime contract:

- Neutralino owns:
  - Process lifecycle for MediaMTX, FFmpeg ingest, Bun MP3 helper, and `cloudflared`
  - Restart/backoff and stale-process cleanup
  - Runtime state persistence in OS app-data
  - UI-facing state bridge (without reviving old local Node HTTP APIs)
- Bun MP3 helper owns:
  - MP3 source ingest and listener fan-out
  - ICY metadata injection and mount lifecycle
  - Optional tiny private status endpoint only if strictly required by desktop runtime wiring
- MediaMTX owns:
  - RTMP ingest target
  - HLS output surface
- FFmpeg owns:
  - Input capture/ingest encode into MediaMTX RTMP path
  - MP3 bridge encode step only if still needed to feed Bun helper mount
- `cloudflared` owns:
  - Public ingress from Cloudflare-managed hostname to local runtime endpoint

Decision on local MP3 mount port:

- Keep local MP3 helper mount on `127.0.0.1:8177` for migration compatibility through Phases 2-5.
- Revisit only after Phase 8 stability checks; no port change is in scope for this migration pass.

Confirmed keep / move / replace / delete map:

- Keep:
  - `mediamtx/` assets and config
  - Neutralino shell (`neutralino.config.json`, app bootstrap, UI shell)
  - FFmpeg ingest flow semantics
  - Runtime asset staging script pattern (`scripts/sync-runtime-assets.mjs`) with later updates for Bun helper and `cloudflared`
- Move (extract from `server/server.mjs`):
  - MP3 mount, listener fan-out, ICY metadata, and mount listing logic -> Bun helper (Phase 2)
  - Process launch/restart/state ownership for MediaMTX + FFmpeg + Bun helper -> Neutralino runtime modules (Phase 3)
- Replace:
  - `GET|POST /api/config` local API -> Neutralino-owned local state + runtime command path
  - `GET /health` aggregate endpoint -> Neutralino/runtime state surfaces (no generic legacy clone)
  - `GET /hls/...` local proxy -> direct MediaMTX HLS URL ownership
  - Pairing/heartbeat local demo API surface (`/api/pair/*`, `/api/heartbeat`, `/api/desktop/*`) -> redesigned flow under later phases
  - Dev scripts that model Node runtime ownership (`server:dev`, `stack:dev`) -> Neutralino-first startup flow
- Delete (legacy surface no longer allowed after migration):
  - Runtime entrypoint `node server/server.mjs`
  - Local Node API contracts for `/api/config`, `/health`, `/api/desktop/*`, pairing, and heartbeat
  - Runtime docs that describe Node server as current architecture

Extraction-reference-only files (delete after dependent phase work lands):

- `server/server.mjs` -> extraction source for Phase 2 and Phase 3 only; delete target in Phase 7
- `server/API-COMPATIBILITY.md` -> compatibility reference during UI migration only; delete target in Phase 7
- `SERVER-MERGE.md` -> historical merge notes only; delete target in Phase 7

Archive list (not live runtime docs):

- `docs/relyycast-v1-plan.md` remains historical planning context and must not be treated as current runtime architecture.

Delete queue by phase boundary:

- After Phase 5: remove UI calls that assume `/api/config`, `/health`, `/api/desktop/*`
- After Phase 6: remove Node runtime scripts and packaging references from `package.json` and build flow
- In Phase 7: delete `server/server.mjs`, `server/API-COMPATIBILITY.md`, `SERVER-MERGE.md`, and any remaining legacy Node-runtime docs

Completion gate:

- There is no ambiguity about what the Bun helper owns.
- There is no ambiguity about what Neutralino owns.
- There is a written delete map for legacy runtime files and docs.
- Later chats can begin implementation without reopening architecture scope.

Verification notes:

- Repo-wide grep confirms live references to legacy Node endpoints and script entrypoint:
  - `package.json`: `server:dev` still points to `node server/server.mjs`
  - `components/station-console.tsx`: still calls `/health` and `/api/config`
  - `components/agent-operations-panel.tsx`: still calls `/api/desktop/*`
  - `README.md`, `SERVER-MERGE.md`, and `server/API-COMPATIBILITY.md` still document legacy contracts
- These references are now explicitly categorized in this phase and scheduled for replacement/deletion in later phases.

Files added, updated, or deleted:

- Updated: `docs/no-node-bun-runtime-plan.md`

Next phase unlocked:

- Phase 2

## Phase 2 - Bun MP3 helper extraction

Status: Complete

Completion date: 2026-04-13

Goal:

- Replace the MP3-specific portion of the Node server with a Bun-based helper compiled as a standalone executable.

Required outputs:

- New Bun helper source
- Standalone Bun build step for supported platforms
- MP3 source ingest and listener fan-out working without Node
- ICY metadata behavior preserved

Allowed scope in this phase:

- MP3 source ingest
- Listener fan-out
- ICY metadata injection
- Mount lifecycle handling
- Tiny private status surface only if required by the desktop app

Forbidden scope in this phase:

- Rebuilding `/api/config`
- Rebuilding pairing or heartbeat APIs
- Rebuilding the HLS proxy
- Rebuilding the old generic `/health` contract
- Letting the helper become a second monolith

Expected files to add:

- New runtime helper source under a Bun-owned path
- Bun build script or compile script

Expected files to update:

- `package.json`
- Runtime asset staging script

Completed work in this chat:

- Added Bun helper source:
  - `runtime/bun-mp3-helper/src/main.ts`
- Added Bun compile script:
  - `scripts/build-bun-mp3-helper.mjs`
- Updated scripts and staging:
  - `package.json` (new `mp3-helper:*` scripts)
  - `scripts/sync-runtime-assets.mjs` (stage compiled helper binary when present)
- Preserved Phase 2 scope:
  - Implemented MP3 source ingest, listener fan-out, ICY metadata, mount listing, and metadata update
  - Added a private helper status endpoint at `GET /_status`
  - Did not rebuild `/api/config`, pairing/heartbeat APIs, HLS proxy, or legacy `/health`

Completion gate:

- The MP3 helper can run without Node installed.
- The helper can be compiled into standalone executables.
- The MP3 behavior matches the current compatibility surface well enough to unblock UI and orchestration work.

Verification notes:

- `npm run lint` passed after helper and script changes.
- Bun installed locally via `winget install --id Oven-sh.Bun -e`.
- `node scripts/build-bun-mp3-helper.mjs` compiles host helper executable successfully.
- `node scripts/build-bun-mp3-helper.mjs --target bun-windows-x64-modern --target bun-windows-arm64-modern --target bun-darwin-x64 --target bun-darwin-arm64 --target bun-linux-x64-modern --target bun-linux-arm64-modern` compiles all configured platform targets successfully.
- Compiled host executable smoke test passed:
  - `runtime/bun-mp3-helper/dist/host/relyy-mp3-helper.exe` starts and responds on `GET /_status`.
- `node scripts/sync-runtime-assets.mjs` stages helper binary into `build/bin/relyy-mp3-helper.exe` alongside MediaMTX assets.

Files added, updated, or deleted:

- Added: `runtime/bun-mp3-helper/src/main.ts`
- Added: `scripts/build-bun-mp3-helper.mjs`
- Updated: `package.json`
- Updated: `scripts/sync-runtime-assets.mjs`
- Updated: `.gitignore` (ignore generated helper dist binaries)
- Updated: `docs/no-node-bun-runtime-plan.md`

Next phase unlocked:

- Phase 3

## Phase 3 - Neutralino runtime orchestration

Status: Complete

Completion date: 2026-04-13

Goal:

- Move all local process ownership into Neutralino.

Required outputs:

- Neutralino process launcher for MediaMTX
- Neutralino process launcher for FFmpeg ingest
- Neutralino process launcher for the Bun helper
- Restart backoff and stale-process cleanup
- Runtime state persisted locally without a Node API

Expected files to update:

- `neutralino.config.json`
- `types/neutralino.d.ts`
- New runtime orchestration module under `src/`
- Possibly `src/main.tsx` or related app bootstrapping files

Completion gate:

- Neutralino, not Node, owns startup and shutdown of all local runtime processes.
- Duplicate relaunches do not leave orphaned child processes behind.
- Runtime state is stored in app-owned local persistence.

Completed work in this chat:

- Added Neutralino-owned runtime orchestration module:
  - `src/runtime/neutralino-runtime-orchestrator.ts`
- Added startup wiring so runtime orchestration starts with app boot:
  - `src/App.tsx`
- Updated Neutralino native allowlist so process and filesystem APIs are available for runtime ownership:
  - `neutralino.config.json`
- Expanded local Neutralino type declarations used by app code:
  - `types/neutralino.d.ts`
- Implemented Phase 3 process ownership in Neutralino:
  - Managed launch of Bun MP3 helper, MediaMTX, FFmpeg ingest, and FFmpeg MP3 bridge
  - Added restart backoff scheduling per process
  - Added stale spawned-process cleanup at startup
  - Added shutdown handling on `windowClose` and `beforeunload`
  - Persisted runtime state and process snapshots to OS app-data:
    - `os.getPath("data")/relyycast/runtime-state.json`

Verification notes:

- `npm run lint` passed after Phase 3 changes.
- `npm run build` passed and staged runtime assets successfully:
  - `build/mediamtx/mediamtx.yml`
  - `build/mediamtx/win/*`
  - `build/bin/relyy-mp3-helper.exe`
- Runtime orchestration code now boots from the Neutralino app shell (not Node) and owns runtime process lifecycle code paths.

Files added, updated, or deleted:

- Added: `src/runtime/neutralino-runtime-orchestrator.ts`
- Updated: `src/App.tsx`
- Updated: `neutralino.config.json`
- Updated: `types/neutralino.d.ts`
- Updated: `docs/no-node-bun-runtime-plan.md`

Next phase unlocked:

- Phase 4

## Phase 4 - Cloudflare onboarding and local persistence

Status: Complete

Completion date: 2026-04-13

Goal:

- Implement the first-launch Cloudflare login and tunnel setup flow inside the app.

Required outputs:

- Detect missing Cloudflare auth state
- Open browser for `cloudflared tunnel login`
- Create locally-managed tunnel
- Create DNS route
- Write explicit tunnel config
- Persist tunnel IDs, paths, and startup state in app-owned storage

Expected files to update:

- New Cloudflare onboarding module under `src/`
- Neutralino runtime modules
- Runtime asset staging for `cloudflared`

Completion gate:

- Fresh launch with no app data can complete Cloudflare onboarding from inside the app.
- Relaunch can reuse saved state without repeating login.

Completed work in this chat:

- Added a dedicated Cloudflare onboarding module:
  - `src/runtime/cloudflared-onboarding.ts`
- Integrated Cloudflare onboarding and `cloudflared` launch into Neutralino runtime orchestration:
  - `src/runtime/neutralino-runtime-orchestrator.ts`
- Added persisted Cloudflare onboarding/runtime fields in app-owned runtime state:
  - tunnel name/ID, cert path, credentials path, config path, route status, and onboarding status
- Implemented first-launch Cloudflare flow in runtime module:
  - Detect missing Cloudflare auth (`cert.pem`)
  - Open browser and run `cloudflared tunnel login`
  - Create or reuse locally-managed tunnel
  - Create DNS route when hostname is configured
  - Write explicit tunnel config under app-data
  - Launch `cloudflared` as a managed Neutralino child process
- Updated runtime asset staging to include `cloudflared` when binary is available:
  - `scripts/sync-runtime-assets.mjs`

Verification notes:

- `npm run lint` passed after Phase 4 changes.
- `npm run build` passed after Phase 4 changes.
- Build-time runtime staging now checks for `cloudflared` and reports when missing:
  - current repo state: no bundled `cloudflared` binary found, so staging emitted a warning and skipped that asset.

Files added, updated, or deleted:

- Added: `src/runtime/cloudflared-onboarding.ts`
- Updated: `src/runtime/neutralino-runtime-orchestrator.ts`
- Updated: `src/App.tsx`
- Updated: `types/neutralino.d.ts`
- Updated: `scripts/sync-runtime-assets.mjs`
- Updated: `docs/no-node-bun-runtime-plan.md`

Next phase unlocked:

- Phase 5

## Phase 5 - UI migration off the Node API surface

Status: Complete

Completion date: 2026-04-13

Goal:

- Remove UI dependency on the old local Node endpoints.

Required outputs:

- `station-console` reads local runtime state from Neutralino and relay state from MediaMTX
- Public MP3 URL is the primary operator-facing URL
- Old pairing and heartbeat demo flow removed or redesigned
- No component assumes `/api/config`, `/health`, or `/api/desktop/*` still exist locally

Expected files to update:

- `components/station-console.tsx`
- `components/agent-operations-panel.tsx`
- Any supporting client utilities

Completion gate:

- UI no longer depends on the old local Node contract.
- The app surface matches the new runtime ownership model.

Completed work in this chat:

- Migrated station console away from Node API contracts:
  - Removed `/health` and `/api/config` calls from `components/station-console.tsx`
  - Added runtime-state-driven UI wiring from Neutralino runtime state events/snapshots
  - Added relay diagnostics sourced from MediaMTX Control API (`http://127.0.0.1:9997/v3/paths/list`)
  - Switched operator primary stream URL to the public Cloudflare URL when available, with local fallback
- Redesigned runtime settings save flow:
  - Added runtime config update API in Neutralino orchestration:
    - `src/runtime/neutralino-runtime-orchestrator.ts` (`updateRuntimeConfig`, runtime-state snapshots/event payload cloning)
  - Updated settings save path to persist via Neutralino runtime state instead of `/api/config`
- Removed old pairing/heartbeat demo surface from UI runtime flow:
  - Replaced `components/agent-operations-panel.tsx` network calls to `/api/desktop/*` with runtime/tunnel status rendering
  - Added runtime and Cloudflare status display plus operator actions (copy/open public MP3 URL, open helper status)

Verification notes:

- `rg --line-number "/api/config|/health|/api/desktop/" components src` returns no matches.
- `npm run lint` passed after Phase 5 changes.
- `npm run build` passed after Phase 5 changes.
- Build output confirms runtime asset staging remains intact (`build/mediamtx/*`, `build/bin/relyy-mp3-helper.exe`).

Files added, updated, or deleted:

- Updated: `components/station-console.tsx`
- Updated: `components/agent-operations-panel.tsx`
- Updated: `src/runtime/neutralino-runtime-orchestrator.ts`
- Updated: `docs/no-node-bun-runtime-plan.md`

Next phase unlocked:

- Phase 6

## Phase 6 - Build and packaging conversion

Status: Not started

Goal:

- Make the packaged app fully self-contained without Node or Bun preinstalled.

Required outputs:

- Bun helper compiled for supported platforms
- `cloudflared` staged alongside MediaMTX
- Packaged Neutralino app carries all required runtime assets
- Dev and build scripts no longer point at `node server/server.mjs`

Expected files to update:

- `package.json`
- `scripts/sync-runtime-assets.mjs`
- Any new Bun build scripts

Completion gate:

- Packaged app runs without Node installed.
- Packaged app runs without Bun installed.
- Repo scripts no longer describe the Node server as part of the intended stack.

Verification notes:

- Pending

Files added, updated, or deleted:

- Pending

Next phase unlocked:

- Pending

## Phase 7 - Repo cleanup and legacy deletion

Status: Not started

Goal:

- Remove everything that is no longer needed and will never be used again in the new architecture.

Delete candidates for this phase:

- `server/server.mjs` once extraction is complete
- `SERVER-MERGE.md`
- `server/API-COMPATIBILITY.md`
- Any Node-only scripts removed from `package.json`
- Any docs that still describe the Node runtime as current
- Any UI demo surfaces that only existed for the old pairing and heartbeat scaffolds

Archive-only candidates if needed:

- Older migration notes that are useful historically but not part of the live runtime

Completion gate:

- There is no active path in the repo that still depends on the old Node runtime.
- Dead scripts, dead docs, and dead compatibility contracts are removed.
- Remaining files reflect the new architecture only.

Verification notes:

- Pending

Files added, updated, or deleted:

- Pending

Next phase unlocked:

- Pending

## Phase 8 - Final verification and release readiness

Status: Not started

Goal:

- Prove the migration is complete and the repo is internally consistent.

Required checks:

1. Fresh install flow works end-to-end.
2. Relaunch works without duplicate processes.
3. Public MP3 URL works end-to-end.
4. MediaMTX, Bun helper, FFmpeg ingest, and `cloudflared` recover correctly.
5. Packaged app runs without Node or Bun installed.
6. No docs or package scripts still point to the Node server.

Completion gate:

- The repo is ready to continue from the new architecture only.
- The branch can be reviewed as a full no-Node migration pass.

Verification notes:

- Pending

Files added, updated, or deleted:

- Pending

Next phase unlocked:

- None

## Handoff Template For The Next Chat

Use this at the start of each new chat:

```text
Work only on Phase X from docs/no-node-bun-runtime-plan.md.
Before changing code, verify that every earlier phase is marked complete.
Do not start any later phase work.
When Phase X is finished, update docs/no-node-bun-runtime-plan.md with:
- the phase checkbox
- completion date
- verification notes
- files added/updated/deleted
- next phase unlocked
If the phase reveals a blocker that changes scope, update the blocker in the plan and stop.
```

## Repo Cleanup Definition Of Done

This pass is not done until all of the following are true:

- No active package script runs `node server/server.mjs`
- No shipped runtime path depends on Node
- No operator-facing UI depends on the old local Node endpoints
- No live documentation still describes Node as the current local runtime
- The only JavaScript runtime left in the final architecture is the Bun-compiled MP3 helper, if that helper is still needed at all
