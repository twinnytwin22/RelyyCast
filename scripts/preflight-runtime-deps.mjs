import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
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

function resolveBunExecutable() {
  if (process.env.BUN_BIN?.trim() && existsSync(process.env.BUN_BIN.trim())) {
    return process.env.BUN_BIN.trim();
  }

  if (process.platform === "win32") {
    const userProfile = process.env.USERPROFILE ?? "";
    const candidates = [
      userProfile ? path.resolve(userProfile, ".bun", "bin", "bun.exe") : "",
      userProfile
        ? path.resolve(
          userProfile,
          "AppData",
          "Local",
          "Microsoft",
          "WinGet",
          "Packages",
          "Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe",
          "bun-windows-x64",
          "bun.exe",
        )
        : "",
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  } else {
    const home = process.env.HOME ?? "";
    const candidates = [
      home ? path.resolve(home, ".bun", "bin", "bun") : "",
      "/opt/homebrew/bin/bun",
      "/usr/local/bin/bun",
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  const probe = spawnSync("bun", ["--version"], { stdio: "pipe" });
  if (probe.status === 0) {
    return "bun";
  }

  return null;
}

async function main() {
  const hostPlatform = getHostPlatformKey();
  const assets = await readManifest();

  const requiredMissing = [];
  const optionalMissing = [];

  for (const asset of assets) {
    if (!shouldApplyAssetToPlatform(asset, hostPlatform)) {
      continue;
    }

    const sourceValue = resolveManifestPathValue(asset, "source", hostPlatform);
    if (!sourceValue) {
      const descriptor = `${asset.id || "unknown"}: no source mapping for platform ${hostPlatform}`;
      if (asset.required === true) {
        requiredMissing.push(descriptor);
      } else {
        optionalMissing.push(descriptor);
      }
      continue;
    }

    const sourcePath = path.resolve(REPO_ROOT, sourceValue);
    if (!existsSync(sourcePath)) {
      const descriptor = `${asset.id || "unknown"}: ${sourceValue}`;
      if (asset.required === true) {
        requiredMissing.push(descriptor);
      } else {
        optionalMissing.push(descriptor);
      }
    }
  }

  console.log(`[preflight] host platform: ${hostPlatform}`);

  if (requiredMissing.length) {
    console.error("[preflight] missing required runtime dependency files:");
    for (const missing of requiredMissing) {
      console.error(`  - ${missing}`);
    }
    console.error("[preflight] add required files under binaries/ before running app/build commands.");
  } else {
    console.log("[preflight] required runtime dependency files: OK");
  }

  if (optionalMissing.length) {
    console.warn("[preflight] missing optional runtime dependency files:");
    for (const missing of optionalMissing) {
      console.warn(`  - ${missing}`);
    }
  }

  const bunExecutable = resolveBunExecutable();
  if (!bunExecutable) {
    console.warn("[preflight] Bun is not available globally.");
    console.warn("[preflight] install Bun globally to use MP3 helper development workflows:");
    if (process.platform === "win32") {
      console.warn("  powershell -c \"irm bun.sh/install.ps1 | iex\"");
    } else {
      console.warn("  curl -fsSL https://bun.com/install | bash");
    }
  } else {
    console.log(`[preflight] Bun: ${bunExecutable}`);
  }

  if (requiredMissing.length) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[preflight] failed:", error.message);
  process.exit(1);
});
