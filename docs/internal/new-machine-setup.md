# RelyyCast New Machine Setup

Use this checklist when setting up a fresh macOS or Windows machine.

## 1. Clone and install dependencies

```bash
git clone <your-repo-url>
cd relyycast
npm install
```

## 2. Seed canonical binary inventory

This copies available binaries from legacy repo paths into the canonical inventory location.

```bash
npm run deps:seed
```

## 3. Validate runtime dependencies

```bash
npm run deps:preflight
```

If preflight reports missing required files, add them under `binaries/` for your platform:

- macOS:
  - `binaries/mediamtx/mac/mediamtx`
  - `binaries/cloudflared/mac/cloudflared`
  - `binaries/mp3-helper/mac/relyy-mp3-helper` (optional)
- Windows:
  - `binaries/mediamtx/win/mediamtx.exe`
  - `binaries/cloudflared/win/cloudflared.exe`
  - `binaries/mp3-helper/win/relyy-mp3-helper.exe` (optional)

## 4. Stage runtime dependencies

```bash
npm run deps:stage
```

## 5. Start app in development mode

```bash
npm run neutralino:run
```

## macOS-specific notes

1. Ensure unix binaries are executable after copying:

```bash
chmod +x binaries/mediamtx/mac/mediamtx binaries/cloudflared/mac/cloudflared
chmod +x binaries/mp3-helper/mac/relyy-mp3-helper 2>/dev/null || true
```

2. Verify staged files:

```bash
ls -l build/mediamtx/mac/mediamtx build/bin/cloudflared
```

## Windows-specific notes

1. Use PowerShell for all setup commands.

2. If downloaded binaries are blocked by Windows:

```powershell
Get-ChildItem binaries -Recurse -File | Unblock-File
```

3. Verify staged files:

```powershell
Get-Item build/mediamtx/win/mediamtx.exe, build/bin/cloudflared.exe
```

## Packaging checklist

Run before creating installers:

```bash
npm run deps:preflight
npm run deps:stage
npm run neutralino:build
npm run installer:build
```
