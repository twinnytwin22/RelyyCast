# RelyyCast v1 Plan

## Implementation Progress

Last updated: 2026-04-10

- [x] Plan reviewed and repo structure audited
- [x] Built the public landing page and initial console shell
- [x] Added login and station route scaffolds
- [x] Updated the app metadata and operator-first surface styling
- [x] Verified lint and a webpack production build
- [x] Compacted the UI into an Icecast-sized dark window with tabs and tighter copy
- [x] Collapsed the web app into one screen and redirected legacy routes to root
- [x] Added a desktop shell scaffold that loads the same screen
- [ ] Add desktop pairing and heartbeat scaffolds
- [ ] Add server-only provisioning, billing, and Cloudflare integrations

Current stop point:

- The public landing, login, and station shells are live.
- The app now opens as one compact screen from the web root.
- A standalone desktop agent architecture is scaffolded for continued implementation.
- Next pass should wire auth, station CRUD, and desktop pairing data flows.

Verification note:

- `npm run lint` passed.
- `npx next build --webpack` passed.
- `npm run build` hit a Turbopack environment port-binding error in this sandbox, so webpack was used for the production verification step.

## Goal

Build the first usable version of RelyyCast as a control plane plus desktop agent that:

1. Lets a user create a station.
2. Assigns that station a public MP3 URL on a Relyy-owned domain.
3. Runs a local streaming origin on the user's desktop.
4. Connects the public URL to that local origin through a Cloudflare Tunnel created in your account.
5. Optionally gates custom domains behind a paid plan.

This should feel like an operator console, not a marketing site.

## Product Positioning

RelyyCast v1 is not a cloud relay network yet. It is a managed "public bridge" from a user's desktop to the internet.

That means:

- The public stream lives behind Cloudflare, but the origin still runs on the user's machine.
- Concurrent listeners consume the user's upload bandwidth.
- If the desktop app stops, the stream stops.

That is acceptable for v1 as long as the UI is honest about it.

## v1 Scope

### In

- Email-based account creation and login with Supabase Auth.
- One primary station per user account to start.
- One public MP3 endpoint per station: `/live.mp3`.
- A Relyy-owned default hostname, for example `station-slug.stream.relyycast.com`.
- Desktop pairing flow.
- Desktop app that:
  - hosts a local HTTP MP3 stream origin,
  - captures one selected audio input,
  - encodes audio to MP3,
  - runs `cloudflared` as a managed child process,
  - reports heartbeat and health.
- Billing gate for custom domains.
- Internal Cloudflare provisioning from your server only.

### Explicitly out for v1

- Multi-station teams and org roles.
- Full analytics or listener geography.
- HLS/transcoding ladders.
- Built-in playlist automation.
- Native system audio capture on every OS.
- High-scale relay/CDN fanout.
- True apex custom domains at launch.

## First-Iteration Product Rules

- Keep the first stream mode simple: selected microphone or line-in / virtual audio device.
- Default bitrate should be conservative, for example `64 kbps mono` or `128 kbps stereo`.
- Surface a soft listener limit based on bitrate and upload speed.
- Show a warning that the station is only live while the desktop app is running.

## UX Direction

Use the style from `EXTERNAL_SKILL.md`:

- Dense, operator-first layout.
- Compact panels, visible borders, quiet surfaces.
- Minimal motion.
- Monospace only for URLs, ports, states, and timings.
- No hero marketing homepage once authenticated.

### Core Screens

1. Public landing page
   - Short explanation
   - Login / signup
   - Download desktop app CTA

2. Station dashboard
   - Stream URL
   - Copy/open/test actions
   - Tunnel status
   - Desktop agent status
   - Selected audio input
   - Bitrate
   - Domain panel
   - Event log

3. Pair desktop modal
   - Short pairing code
   - Current desktop status
   - Approve button

4. Billing and domain settings
   - Free plan vs custom domain plan
   - Domain verification state
   - SSL readiness

### Dashboard Wireframe

```text
+--------------------------------------------------------------------------------+
| RelyyCast Console                Station: WXYZ FM              OFFLINE / LIVE |
+-----------------------------------+--------------------------------------------+
| Public Stream                     | Tunnel / Agent                             |
| https://wxyz.stream.../live.mp3   | Tunnel: connected                          |
| Copy URL  Test Stream             | Agent: online                              |
| Public hostname                   | Last heartbeat: 12s ago                    |
+-----------------------------------+--------------------------------------------+
| Audio Source                      | Domain                                     |
| Input: BlackHole 2ch              | Default domain active                      |
| Bitrate: 128 kbps stereo          | Custom domain locked / pending / active    |
| Start / Stop stream               | Upgrade / verify / remove                  |
+-----------------------------------+--------------------------------------------+
| Activity Log                                                                   |
| Tunnel created, desktop paired, stream started, token rotated, domain verified |
+--------------------------------------------------------------------------------+
```

## Recommended Architecture

### 1. Web control plane

Use the current Next.js 16 App Router app as the control plane.

- Server Components for dashboard reads.
- Client Components only for interactive panels.
- Server Actions for form-style mutations.
- Route Handlers for desktop endpoints and webhooks.
- `proxy.ts` for Supabase auth token refresh and route protection.
- A small server-only data access layer for all database reads/writes.

### 2. Supabase

Use Supabase for:

- Auth
- Postgres
- Row-level security
- Optional storage later for logos or release manifests

### 3. Cloudflare

Use your Cloudflare account for:

- Named remotely-managed tunnels
- Default DNS hostnames in your zone
- Future custom hostnames for paid domains

### 4. Desktop app

The desktop app should be an agent, not a full browser-first app.

Responsibilities:

- Display pairing code and local status.
- Request local permissions.
- Run local MP3 origin on a fixed localhost port, for example `8177`.
- Spawn FFmpeg for audio capture + encoding.
- Spawn `cloudflared tunnel run --token ...`.
- Store sensitive local values using OS-backed secure storage when available.
- Send heartbeats to the web app.

## Why this split is the right v1

- The web app owns identity, billing, provisioning, and visibility.
- The desktop app owns only local media and the tunnel process.
- Cloudflare API credentials never leave the server.
- The desktop app only receives a per-tunnel token after pairing.

## End-to-End Flow

### User flow

1. User signs up in the web app.
2. User creates a station slug.
3. Server provisions a tunnel and default hostname.
4. User downloads the desktop app.
5. Desktop app shows a pairing code.
6. User approves that code in the web app.
7. Desktop app receives station config plus tunnel token.
8. Desktop app asks for microphone access, selects input, and starts stream services.
9. Dashboard turns green when heartbeat and tunnel are healthy.
10. User upgrades to enable custom domain onboarding.

### Provisioning flow

1. Insert `stations` row in Supabase.
2. Call Cloudflare Tunnel API to create a remotely-managed tunnel.
3. Get the tunnel token from Cloudflare.
4. Create a proxied CNAME in your zone pointing `station-slug.stream.relyycast.com` to `<tunnel-id>.cfargotunnel.com`.
5. Persist the Cloudflare IDs and encrypted tunnel token.
6. Return the assigned public stream URL.

## Cloudflare Design

### Default hostname model

Use one Relyy-owned zone dedicated to streams, for example:

- `stream.relyycast.com`
- `radio.relyycast.com`

Each station gets:

- `https://<station-slug>.stream.relyycast.com/live.mp3`

### Tunnel model

Use remotely-managed tunnels, one tunnel per station.

Reasoning:

- Cloudflare recommends remotely-managed tunnels for most cases.
- The desktop only needs a tunnel token.
- The tunnel can be provisioned and rotated from the server.

### Public routing model

Use a fixed local service target:

- public hostname -> Cloudflare tunnel -> `http://127.0.0.1:8177`

Inside the desktop app, the local origin exposes:

- `GET /live.mp3`
- `GET /health`

### Cloudflare zone settings to apply early

- Cache bypass for `*.stream.relyycast.com/live.mp3`
- No challenge pages on stream URLs
- Conservative WAF rules so audio players are not blocked
- Clear DNS cleanup on station deletion

### Cloudflare API token permissions

Create a dedicated API token for the app server with the narrowest scopes possible.

At minimum for the default-hostname release:

- Account-level tunnel write permission
- Zone-level DNS edit permission for the RelyyCast stream zone
- Zone-level DNS read permission for reconciliation and cleanup

Add later for paid custom domains:

- Zone-level SSL and Certificates write permission for custom hostnames

Do not use a global API key.

## Custom Domain Strategy

This is the biggest product decision in the plan.

### Recommendation

Launch public beta with only Relyy-owned subdomains enabled.

Build the paid custom-domain UI now, but only turn on actual bring-your-own-domain routing after Cloudflare for SaaS is enabled on your zone.

### Why

Cloudflare Tunnel hostnames based on `cfargotunnel.com` only proxy for DNS records in the same Cloudflare account. That means a customer-owned domain in another account is not a simple "add a CNAME and done" feature.

For real custom domains, the scalable path is:

- Cloudflare for SaaS custom hostnames

### Practical v1 custom-domain policy

- Paid plan required
- Support subdomains first, for example `radio.customer.com`
- Do not support apex domains in the first release
- Mark apex support as future work

## Desktop App Design

### Local services

Run three things in the desktop app:

1. `ffmpeg` child process for capture + MP3 encoding
2. local Node HTTP server for `/live.mp3`
3. `cloudflared` child process for tunnel connectivity

### Audio approach

For the first release, support:

- microphone
- hardware line-in
- virtual audio device

Do not promise universal "system audio capture" on day one. It is much more OS-specific and permission-heavy than microphone or line-in capture.

### Stream server behavior

- Fan out a single encoded MP3 stream to all connected listeners.
- Keep `/live.mp3` long-lived and chunked.
- Expose `/health` with encoder, tunnel, and listener status.
- Restart child processes with bounded retry and clear error states.

### Desktop storage

Store locally:

- agent id
- station id
- encrypted refresh token if needed
- tunnel token
- last selected audio device
- bitrate preset

Use OS-backed secure storage when available and fall back carefully on Linux.

## Permissions and OS Requirements

### Required for v1

- Network access
- Microphone permission when the selected source is a microphone or input device
- Auto-launch at login if the user enables it

### macOS

- Add `NSMicrophoneUsageDescription`
- If you later support system audio capture through `desktopCapturer`, add `NSAudioCaptureUsageDescription`
- Expect app restart after denied media permissions are changed in System Settings
- Plan for code signing and notarization before public testing

### Windows

- Respect the system microphone privacy toggle
- Sign the app to reduce SmartScreen friction

### Linux

- Treat secure storage as best-effort because available secret stores vary
- Expect more audio stack variance across PulseAudio / PipeWire / ALSA

## Security Model

- Never expose the Cloudflare API token to the browser or desktop app.
- Encrypt Cloudflare tunnel tokens at rest in the database.
- Give the desktop app only station-scoped credentials after pairing.
- Use RLS for all user-owned rows.
- Use a server-only DAL and DTOs for dashboard data.
- Log every provision, rotate, delete, pair, and custom-domain action.

## Supabase Schema

Keep the schema lean.

### `profiles`

- `id`
- `email`
- `display_name`
- `created_at`

### `stations`

- `id`
- `owner_user_id`
- `name`
- `slug`
- `status`
- `public_base_url`
- `stream_path`
- `bitrate_preset`
- `created_at`

### `station_tunnels`

- `station_id`
- `cloudflare_tunnel_id`
- `cloudflare_tunnel_name`
- `cloudflare_token_encrypted`
- `dns_record_id`
- `hostname`
- `status`
- `last_synced_at`

### `station_agents`

- `id`
- `station_id`
- `device_name`
- `platform`
- `app_version`
- `last_seen_at`
- `local_port`
- `permission_state`
- `status`

### `agent_pairings`

- `id`
- `pairing_code`
- `station_id`
- `agent_id`
- `expires_at`
- `approved_at`
- `consumed_at`

### `custom_domains`

- `id`
- `station_id`
- `hostname`
- `status`
- `verification_method`
- `verification_target`
- `ssl_status`
- `cloudflare_custom_hostname_id`

### `billing_customers`

- `user_id`
- `stripe_customer_id`
- `plan_code`
- `subscription_status`

### `audit_events`

- `id`
- `station_id`
- `actor_type`
- `actor_id`
- `event_type`
- `payload`
- `created_at`

## Next.js App Structure

Recommended route layout:

```text
app/
  (public)/
    page.tsx
    login/page.tsx
  (console)/
    layout.tsx
    stations/page.tsx
    stations/new/page.tsx
    stations/[stationId]/page.tsx
    stations/[stationId]/domain/page.tsx
    desktop/link/page.tsx
  api/
    desktop/pair/start/route.ts
    desktop/pair/status/route.ts
    desktop/heartbeat/route.ts
    stations/[stationId]/provision/route.ts
    webhooks/stripe/route.ts
data/
  auth.ts
  stations.ts
  billing.ts
  cloudflare.ts
lib/
  supabase/
  crypto/
  validators/
proxy.ts
```

## Environment and Secrets

### Web app

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_ZONE_ID`
- `CLOUDFLARE_API_TOKEN`
- `RELYYCAST_STREAM_ROOT_DOMAIN`
- `APP_ENCRYPTION_KEY`
- `DESKTOP_AGENT_SIGNING_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

### Desktop app

- no long-lived master secrets bundled into the app
- station-scoped tunnel token only after pairing
- signed desktop release channel URL if auto-updates are enabled later

## Implementation Notes for the Current Repo

Because this repo is still nearly empty, keep the Next.js app at the root for now.

Do not introduce a full monorepo before the first milestone ships.

Instead:

- keep the web app in the current root
- add `desktop/` when implementation starts
- add a small shared `contracts/` folder only if types begin drifting

## Billing Plan

Use Stripe for one paid feature gate:

- Free: default RelyyCast hostname
- Paid: custom domain onboarding

Keep billing simple:

- monthly plan
- Stripe Checkout
- Stripe customer portal
- Stripe webhook updates `billing_customers`

## Operational Constraints to Be Honest About

- Listener scale depends on the broadcaster's upload bandwidth.
- If the desktop sleeps, quits, or loses internet, the stream drops.
- Tunnel token rotation needs a reconnect window unless you later add dual replicas.
- Some players are sensitive to Cloudflare challenges and caching, so stream hostnames need special rules.

## Recommended Milestones

### Milestone 1: Foundation

- Supabase auth
- protected console shell
- design tokens and dashboard layout
- station schema
- audit log table

### Milestone 2: Default hostname provisioning

- create station action
- Cloudflare tunnel creation
- DNS record creation
- dashboard status card

### Milestone 3: Desktop pairing and local origin

- desktop shell
- pairing code flow
- local `/health`
- local `/live.mp3`
- FFmpeg capture
- cloudflared child process

### Milestone 4: Hardening

- heartbeat and retry logic
- secure local storage
- better error states
- signed desktop builds
- stream URL testing tools

### Milestone 5: Paid custom domains

- Stripe gate
- custom-domain UI
- Cloudflare for SaaS onboarding
- verification states
- SSL readiness

## Build Order I Recommend

Build in this order:

1. Console shell and data model
2. Cloudflare provisioning for default URLs
3. Pairing flow
4. Desktop local stream engine
5. Billing
6. Custom domains

This keeps the hardest integration points isolated and lets you test real value before taking on custom-domain edge cases.

## Biggest Risks

1. Custom domains are not a small add-on. They are a separate Cloudflare product decision.
2. Desktop upload bandwidth will define listener capacity.
3. System audio capture across OSes is much harder than microphone or line-in capture.
4. Shipping unsigned desktop builds will create trust friction fast.
5. FFmpeg distribution and licensing need to be checked before release packaging.

## Recommended Decision for Us Right Now

Use this exact v1 scope:

- one station per account
- default RelyyCast public URL
- desktop agent with microphone / line-in / virtual-device capture
- paid plan scaffolded in UI
- custom domains held until Cloudflare for SaaS is enabled

That is the smallest version that is still real, demoable, and commercially aligned with your idea.

## References

- Next.js local docs in `node_modules/next/dist/docs/`
- `EXTERNAL_SKILL.md`
- Cloudflare Tunnel API and DNS routing docs
- Cloudflare for SaaS custom hostnames docs
- Supabase Next.js SSR auth docs
- Desktop media permissions and secure storage docs
