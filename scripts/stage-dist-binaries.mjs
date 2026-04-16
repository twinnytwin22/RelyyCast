/**
 * Copies runtime binaries into dist/relyycast/ after `neu build` so they exist
 * as real OS-accessible files beside the executable (not packed inside resources.neu).
 *
 * The app's runtime resolver looks for:
 *   {NL_PATH}/build/mediamtx/<platform>/mediamtx[.exe]
 *   {NL_PATH}/build/bin/cloudflared[.exe]
 *   {NL_PATH}/build/bin/relyy-mp3-helper[.exe]
 */

import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const BUILD_ROOT = path.resolve(REPO_ROOT, "build");
const DIST_APP_ROOT = path.resolve(REPO_ROOT, "dist", "relyycast");

function getPlatformFolder() {
  if (process.platform === "win32") {
    return "win";
  }
  if (process.platform === "darwin") {
    return "mac";
  }
  return "linux";
}

function getRequiredBuildInputs() {
  const platformFolder = getPlatformFolder();
  const mediamtxBinaryName = process.platform === "win32" ? "mediamtx.exe" : "mediamtx";
  const cloudflaredBinaryName = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";

  return [
    path.resolve(BUILD_ROOT, "mediamtx", "mediamtx.yml"),
    path.resolve(BUILD_ROOT, "mediamtx", platformFolder, mediamtxBinaryName),
    path.resolve(BUILD_ROOT, "bin", cloudflaredBinaryName),
  ];
}

function validateRequiredBuildInputs() {
  const missing = getRequiredBuildInputs().filter((pathname) => !existsSync(pathname));
  if (!missing.length) {
    return;
  }

  console.error("[stage-dist] required staged binaries are missing from build/:");
  for (const pathname of missing) {
    console.error(`  - ${path.relative(REPO_ROOT, pathname)}`);
  }
  console.error("[stage-dist] run `npm run deps:preflight` and `npm run deps:stage` before packaging.");
  process.exit(1);
}

async function copyIfPresent(src, dest) {
  if (!existsSync(src)) return false;
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true, force: true });
  return true;
}

async function main() {
  if (!existsSync(DIST_APP_ROOT)) {
    console.error("[stage-dist] dist/relyycast not found — run neu build first");
    process.exit(1);
  }

  validateRequiredBuildInputs();

  const staged = [];

  // mediamtx — copy whole platform folder (mediamtx/win or mediamtx/mac)
  const platformFolder = getPlatformFolder();
  const mediamtxSrc = path.resolve(BUILD_ROOT, "mediamtx", platformFolder);
  const mediamtxDest = path.resolve(DIST_APP_ROOT, "build", "mediamtx", platformFolder);
  if (await copyIfPresent(mediamtxSrc, mediamtxDest)) {
    staged.push(`build/mediamtx/${platformFolder}`);
  }

  const mediamtxConfigSrc = path.resolve(BUILD_ROOT, "mediamtx", "mediamtx.yml");
  const mediamtxConfigDest = path.resolve(DIST_APP_ROOT, "build", "mediamtx", "mediamtx.yml");
  if (await copyIfPresent(mediamtxConfigSrc, mediamtxConfigDest)) {
    staged.push("build/mediamtx/mediamtx.yml");
  }

  // bin — copy entire build/bin directory (cloudflared, mp3-helper)
  const binSrc = path.resolve(BUILD_ROOT, "bin");
  const binDest = path.resolve(DIST_APP_ROOT, "build", "bin");
  if (existsSync(binSrc)) {
    await mkdir(binDest, { recursive: true });
    for (const file of readdirSync(binSrc).filter((f) => !f.startsWith("."))) {
      const src = path.resolve(binSrc, file);
      const dest = path.resolve(binDest, file);
      await cp(src, dest, { force: true });
      staged.push(`build/bin/${file}`);
    }
  }

  if (!staged.length) {
    console.warn("[stage-dist] no binaries staged to dist — check build/ output");
    return;
  }

  console.log(`[stage-dist] copied to dist/relyycast: ${staged.join(", ")}`);
}

main().catch((err) => {
  console.error("[stage-dist] failed:", err);
  process.exit(1);
});
