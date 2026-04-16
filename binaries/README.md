# Runtime Dependency Binary Inventory

This folder is the canonical source of runtime dependency binaries for local development and packaging.

Policy:
- Commit folder structure and metadata files only.
- Do not commit binary payloads to git.
- Place raw binaries locally in the paths defined below before running app/build/installer commands.

Required global dependency:
- Bun must be installed globally for MP3 helper development workflows.
- If Bun is missing, run:
  - macOS/Linux: `curl -fsSL https://bun.com/install | bash`
  - Windows (PowerShell): `powershell -c "irm bun.sh/install.ps1 | iex"`

Canonical host paths (drop files here locally):
- MediaMTX config:
  - `binaries/mediamtx/mediamtx.yml`
- macOS:
  - `binaries/mediamtx/mac/mediamtx`
  - `binaries/cloudflared/mac/cloudflared`
  - `binaries/mp3-helper/mac/relyy-mp3-helper` (optional if MP3 output is disabled)
- Windows:
  - `binaries/mediamtx/win/mediamtx.exe`
  - `binaries/cloudflared/win/cloudflared.exe`
  - `binaries/mp3-helper/win/relyy-mp3-helper.exe` (optional if MP3 output is disabled)
- Linux:
  - `binaries/mediamtx/linux/mediamtx`
  - `binaries/cloudflared/linux/cloudflared`
  - `binaries/mp3-helper/linux/relyy-mp3-helper` (optional if MP3 output is disabled)

Flow:
1. Populate `binaries/` with host runtime dependencies.
2. Run `npm run deps:preflight`.
3. Run `npm run deps:stage`.
4. Run `npm run neutralino:run` or `npm run neutralino:build`.

Notes:
- Staged runtime artifacts are copied into `build/` and then into `dist/relyycast/build/` during packaging.
- Installer scripts consume staged outputs from `dist/relyycast/build/`.

## macOS usage notes

- Keep executable permission on unix binaries after dropping/updating files:

```bash
chmod +x binaries/mediamtx/mac/mediamtx binaries/cloudflared/mac/cloudflared
chmod +x binaries/mp3-helper/mac/relyy-mp3-helper 2>/dev/null || true
```

- Validate and stage:

```bash
npm run deps:preflight
npm run deps:stage
```

## Windows usage notes

- Ensure filenames are exactly:
  - `mediamtx.exe`
  - `cloudflared.exe`
  - `relyy-mp3-helper.exe` (optional)

- Validate and stage (PowerShell):

```powershell
npm run deps:preflight
npm run deps:stage
```

- If binaries are blocked after download, unblock once:

```powershell
Get-ChildItem binaries -Recurse -File | Unblock-File
```
