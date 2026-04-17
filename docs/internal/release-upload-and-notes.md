# Release Upload And Patch Notes

This workflow publishes the newest installer artifact to R2 and generates patch notes for Git and website publishing.

## Prerequisites

- Build artifacts already exist (run `npm run installer:build` first)
- R2 credentials are present as environment variables:
  - `S3_ENDPOINT`
  - `S3_BUCKET`
  - `S3_KEY`
  - `S3_SECRET`
  - Optional: `S3_REGION` (defaults to `auto`)
  - Optional: `S3_PUBLIC_URL` (for printing public URL)

## 1) Upload Newest Build To R2

Dry run (recommended first):

```bash
npm run release:upload:r2:dry-run
```

Actual upload:

```bash
npm run release:upload:r2
```

Behavior:

- Selects the newest known installer artifact:
  - `dist/RelyyCast.pkg`
  - `dist/relyycast-setup.exe`
- Uploads under versioned keys:
  - `{prefix}/mac/{version}/RelyyCast.pkg` (macOS)
  - `{prefix}/windows/{version}/relyycast-setup.exe` (Windows)
  - plus `.sha256` and `manifest.json` in the same folder

Notes:

- `{prefix}` comes from `S3_PREFIX` (preferred) or a path segment appended to `S3_BUCKET`.
- `S3_BUCKET` should be the bucket name only; if it includes `/`, the first segment is treated as bucket and the rest as prefix.

Optional overrides:

```bash
npm run release:upload:r2 -- --version 0.1.1
npm run release:upload:r2 -- --artifact dist/RelyyCast.pkg
npm run release:upload:r2 -- --platform macos
```

## 2) Generate Patch Notes For Git + Website

Create a source note file (or copy from template):

```bash
cp scripts/release/templates/patch-notes.template.md /tmp/relyycast-notes.md
```

Generate outputs:

```bash
npm run release:notes -- --notes-file /tmp/relyycast-notes.md
```

Optional overrides:

```bash
npm run release:notes -- --notes-file /tmp/relyycast-notes.md --version 0.1.1 --title "RelyyCast v0.1.1" --date 2026-04-16 --summary "Reliability and packaging improvements"
```

Output files:

- `dist/release-notes/{version}/git-release-notes.md`
- `dist/release-notes/{version}/website-patch-notes.md`
- `dist/release-notes/{version}/website-sanity-payload.json`

Use:

- Paste `git-release-notes.md` into Git release notes
- Use `website-patch-notes.md` for website copy
- Use `website-sanity-payload.json` as structured payload for Sanity changelog entry
