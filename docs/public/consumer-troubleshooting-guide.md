# RelyyCast Consumer Troubleshooting Guide

This guide is for end users running the app, not developers.

If something is not working, start with the quick checks, then use the symptom sections below.

---

## Quick checks (do these first)

1. Fully quit and relaunch RelyyCast.
2. Confirm your internet connection is stable.
3. In the app, open the Control view and check status tiles:
   - Runtime should be running.
   - Relay should be ready when a source is connected.
   - Cloudflare should be ready only if you enabled it.
4. If you changed settings recently, save settings, then restart the app.
5. If MP3 output is disabled in settings, MP3 URL/actions are intentionally unavailable.

---

## Understanding common statuses

### Runtime status

- Starting: app services are launching.
- Running: core services are healthy.
- Error: one or more services failed and need attention.

### Relay status

- Ready: audio is being ingested and relayed.
- Pending: relay is up but no active source is feeding it yet.

### Cloudflare status

- Pending consent: waiting for you to connect Cloudflare.
- Login required: browser authentication is needed.
- Provisioning: tunnel is being configured.
- Ready: public URL is active.
- Error: Cloudflare setup failed.

---

## Symptom: app opens but stream does not play

### What to check

1. Confirm Runtime is running.
2. Confirm your input source URL is valid and currently live.
3. Check whether you are testing MP3 or HLS:
   - MP3 depends on MP3 output being enabled.
   - HLS depends on relay path and active ingest.
4. Wait 5 to 15 seconds after startup before testing stream URLs.

### Fix steps

1. Save settings again.
2. Restart app.
3. Retry using the in-app Open buttons instead of manually typed URLs.

---

## Symptom: MP3 URL shows unavailable or button is disabled

This can be expected behavior.

### Why it happens

1. MP3 output is disabled in settings.
2. MP3 helper service is not active yet.
3. Runtime is not fully started.

### Fix steps

1. Open Settings.
2. Enable MP3 output.
3. Save settings.
4. Restart app.
5. Return to Control and test Open MP3 again.

If your team intentionally disabled MP3 for this station, this is normal.

---

## Symptom: HLS works but MP3 does not

### Likely cause

MP3 path and HLS path are separate outputs. HLS can work while MP3 is disabled or unavailable.

### Fix steps

1. Confirm MP3 output is enabled.
2. Save settings and restart.
3. Verify Runtime returns to running.
4. Retry the MP3 URL from the app.

---

## Symptom: Cloudflare URL does not open

### What to check

1. Cloudflare status should be ready.
2. Confirm you copied the latest URL from the app.
3. If using a temporary URL, it may change after reconnect.

### Fix steps

1. Click Retry for Cloudflare setup in the app.
2. If prompted, complete browser login.
3. Wait until status returns to ready.
4. Copy URL again from the app and retest.

---

## Symptom: Cloudflare status stuck at login required

### Why it happens

Browser auth did not complete or the app could not access Cloudflare credentials yet.

### Fix steps

1. Click Connect again.
2. Complete the browser flow fully.
3. Return to app and click Retry.
4. If still failing, close and reopen app and repeat once.

---

## Symptom: status keeps flipping or reconnecting

### Why it happens

A service is crashing and auto-restarting.

### Fix steps

1. Verify your source URL is reachable.
2. Remove unusual custom values (relay path, custom binary paths) and use defaults.
3. Save settings.
4. Restart app.

If issue persists, collect diagnostics and send to support.

---

## Symptom: settings do not persist

### What to check

1. Confirm you pressed Save Settings.
2. Wait for save confirmation in the app.
3. Avoid closing app immediately after saving.

### Fix steps

1. Save settings again.
2. Restart app.
3. Re-check settings values.

If values reset repeatedly, perform a full reset (below).

---

## Full reset (consumer-safe)

Use this when normal retries fail.

### Steps

1. In app, skip/stop Cloudflare if active.
2. Fully quit app.
3. Delete RelyyCast local app data folder:
   - Windows: `%APPDATA%\relyycast\` and/or `%LOCALAPPDATA%\relyycast\`
   - macOS: `~/Library/Application Support/relyycast/`
   - Linux: `~/.config/relyycast/`
4. Reopen app.
5. Re-enter settings.
6. Reconnect Cloudflare if needed.

Note: reset removes local runtime state and saved settings.

---

## Platform notes for consumers

### Windows

1. If app cannot launch services after update, right-click app and run as Administrator once.
2. Ensure security software is not blocking local networking for the app.
3. If a URL opens in browser but no audio plays, test with a second browser.

### macOS

1. If first launch is blocked, allow app in System Settings > Privacy & Security.
2. If browser does not auto-open for Cloudflare login, open default browser manually and retry from app.
3. After OS updates, restart the machine once before retrying app setup.

---

## When to contact support

Contact support if any of these continue after full reset:

1. Runtime never reaches running.
2. Cloudflare never reaches ready.
3. MP3/HLS URLs fail while statuses show healthy.
4. App crashes on every launch.

Include this information:

1. OS and version (Windows/macOS/Linux).
2. RelyyCast app version.
3. Exact status values shown in app.
4. Whether issue affects MP3, HLS, Cloudflare URL, or all.
5. Screenshot of the Control view and any visible error message.
