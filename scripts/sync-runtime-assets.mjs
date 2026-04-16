import path from "node:path";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const BUILD_ROOT = path.resolve(REPO_ROOT, "build");
const BUILD_MEDIAMTX_ROOT = path.resolve(BUILD_ROOT, "mediamtx");
const BUILD_BIN_ROOT = path.resolve(BUILD_ROOT, "bin");
const BINARIES_MANIFEST_PATH = path.resolve(REPO_ROOT, "binaries", "manifest.json");

function getHostPlatformKey() {
  if (process.platform === "win32") {
    return "win";
  }
  if (process.platform === "darwin") {
    return "darwin";
  }
  return "linux";
}

function resolveManifestPathValue(asset, key, platform) {
  if (typeof asset[key] === "string") {
    return asset[key];
  }

  const byPlatformKey = `${key}ByPlatform`;
  const byPlatform = asset[byPlatformKey];
  if (!byPlatform || typeof byPlatform !== "object") {
    return "";
  }

  const value = byPlatform[platform];
  return typeof value === "string" ? value : "";
}

function shouldApplyAssetToPlatform(asset, platform) {
  const value = typeof asset.platform === "string" ? asset.platform : "host";
  if (value === "any" || value === "host") {
    return true;
  }
  return value === platform;
}

async function copyAsset(sourcePath, destinationPath) {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { recursive: true, force: true });
}

async function readManifest() {
  if (!existsSync(BINARIES_MANIFEST_PATH)) {
    throw new Error(`missing binaries manifest: ${path.relative(REPO_ROOT, BINARIES_MANIFEST_PATH)}`);
  }

  const raw = await readFile(BINARIES_MANIFEST_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.assets)) {
    throw new Error("invalid binaries manifest: expected { assets: [] }");
  }

  return parsed.assets;
}

function isExecutableAsset(asset) {
  return asset.executable === true && process.platform !== "win32";
}

async function applyUnixExecutableBitIfNeeded(destinationPath, asset) {
  if (!isExecutableAsset(asset)) {
    return;
  }
  try {
    await chmod(destinationPath, 0o755);
  } catch (err) {
    throw new Error(`failed to chmod executable ${path.relative(REPO_ROOT, destinationPath)}: ${err.message}`);
  }
}

async function main() {
  const hostPlatform = getHostPlatformKey();
  const assets = await readManifest();

  await mkdir(BUILD_ROOT, { recursive: true });
  try {
    await rm(BUILD_MEDIAMTX_ROOT, { recursive: true, force: true });
    await rm(BUILD_BIN_ROOT, { recursive: true, force: true });
  } catch {
    // Continue and overwrite in place if needed.
  }
  await mkdir(BUILD_MEDIAMTX_ROOT, { recursive: true });
  await mkdir(BUILD_BIN_ROOT, { recursive: true });

  const requiredMissing = [];
  const optionalMissing = [];
  const copiedTargets = [];

  for (const asset of assets) {
    if (!shouldApplyAssetToPlatform(asset, hostPlatform)) {
      continue;
    }

    const sourceValue = resolveManifestPathValue(asset, "source", hostPlatform);
    const destinationValue = resolveManifestPathValue(asset, "destination", hostPlatform);
    if (!sourceValue || !destinationValue) {
      const descriptor = `${asset.id || "unknown"} (platform=${hostPlatform})`;
      if (asset.required === true) {
        requiredMissing.push(`${descriptor}: missing source/destination mapping in binaries/manifest.json`);
      } else {
        optionalMissing.push(`${descriptor}: missing source/destination mapping in binaries/manifest.json`);
      }
      continue;
    }

    const sourcePath = path.resolve(REPO_ROOT, sourceValue);
    const destinationPath = path.resolve(REPO_ROOT, destinationValue);

    if (!existsSync(sourcePath)) {
      const descriptor = `${asset.id || "unknown"} -> ${sourceValue}`;
      if (asset.required === true) {
        requiredMissing.push(descriptor);
      } else {
        optionalMissing.push(descriptor);
      }
      continue;
    }

    await copyAsset(sourcePath, destinationPath);
    await applyUnixExecutableBitIfNeeded(destinationPath, asset);
    copiedTargets.push(path.relative(REPO_ROOT, destinationPath));
  }

  if (optionalMissing.length) {
    console.warn("[build] optional runtime assets missing:");
    for (const missing of optionalMissing) {
      console.warn(`  - ${missing}`);
    }
  }

  if (requiredMissing.length) {
    console.error("[build] required runtime assets missing from canonical binaries inventory:");
    for (const missing of requiredMissing) {
      console.error(`  - ${missing}`);
    }
    console.error("[build] add required files under binaries/ and re-run `npm run deps:stage`.");
    process.exit(1);
  }

  console.log(`[build] staged runtime assets: ${copiedTargets.join(", ")}`);
}

main().catch((error) => {
  console.error("[build] failed to stage MediaMTX runtime assets:", error);
  process.exit(1);
});
