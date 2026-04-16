import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

function getHostPlatformKey() {
  if (process.platform === "win32") {
    return "win";
  }
  if (process.platform === "darwin") {
    return "darwin";
  }
  return "linux";
}

function getFirstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function copyIfMissing(destination, candidates) {
  if (existsSync(destination)) {
    return { copied: false, skipped: true, source: null };
  }

  const source = getFirstExisting(candidates);
  if (!source) {
    return { copied: false, skipped: false, source: null };
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
  return { copied: true, skipped: false, source };
}

function resolveLegacyCloudflaredCandidate(platform) {
  const folder = path.resolve(REPO_ROOT, "cloudflared", platform);
  if (!existsSync(folder)) {
    return null;
  }

  const files = readdirSync(folder).filter((entry) => !entry.startsWith("."));
  if (!files.length) {
    return null;
  }

  return path.resolve(folder, files[0]);
}

async function main() {
  const platform = getHostPlatformKey();
  const localPlatform = platform === "darwin" ? "mac" : platform;

  const copies = [];
  const misses = [];

  const mediamtxConfigDest = path.resolve(REPO_ROOT, "binaries", "mediamtx", "mediamtx.yml");
  const mediamtxConfig = await copyIfMissing(mediamtxConfigDest, [
    path.resolve(REPO_ROOT, "mediamtx", "mediamtx.yml"),
    path.resolve(REPO_ROOT, "build", "mediamtx", "mediamtx.yml"),
  ]);
  if (mediamtxConfig.copied) {
    copies.push([mediamtxConfig.source, mediamtxConfigDest]);
  } else if (!mediamtxConfig.skipped) {
    misses.push(path.relative(REPO_ROOT, mediamtxConfigDest));
  }

  const mediamtxBinaryName = platform === "win" ? "mediamtx.exe" : "mediamtx";
  const mediamtxBinaryDest = path.resolve(REPO_ROOT, "binaries", "mediamtx", localPlatform, mediamtxBinaryName);
  const mediamtxBinary = await copyIfMissing(mediamtxBinaryDest, [
    path.resolve(REPO_ROOT, "mediamtx", localPlatform, mediamtxBinaryName),
    path.resolve(REPO_ROOT, "build", "mediamtx", localPlatform, mediamtxBinaryName),
  ]);
  if (mediamtxBinary.copied) {
    copies.push([mediamtxBinary.source, mediamtxBinaryDest]);
  } else if (!mediamtxBinary.skipped) {
    misses.push(path.relative(REPO_ROOT, mediamtxBinaryDest));
  }

  const cloudflaredBinaryName = platform === "win" ? "cloudflared.exe" : "cloudflared";
  const cloudflaredDest = path.resolve(REPO_ROOT, "binaries", "cloudflared", localPlatform, cloudflaredBinaryName);
  const cloudflared = await copyIfMissing(cloudflaredDest, [
    resolveLegacyCloudflaredCandidate(localPlatform),
    path.resolve(REPO_ROOT, "build", "bin", cloudflaredBinaryName),
  ]);
  if (cloudflared.copied) {
    copies.push([cloudflared.source, cloudflaredDest]);
  } else if (!cloudflared.skipped) {
    misses.push(path.relative(REPO_ROOT, cloudflaredDest));
  }

  const mp3HelperBinaryName = platform === "win" ? "relyy-mp3-helper.exe" : "relyy-mp3-helper";
  const mp3HelperDest = path.resolve(REPO_ROOT, "binaries", "mp3-helper", localPlatform, mp3HelperBinaryName);
  const mp3Helper = await copyIfMissing(mp3HelperDest, [
    path.resolve(REPO_ROOT, "build", "bin", mp3HelperBinaryName),
    path.resolve(REPO_ROOT, "runtime", "bun-mp3-helper", "dist", "host", mp3HelperBinaryName),
  ]);
  if (mp3Helper.copied) {
    copies.push([mp3Helper.source, mp3HelperDest]);
  }

  if (copies.length) {
    console.log("[deps:seed] copied legacy assets into binaries inventory:");
    for (const [source, dest] of copies) {
      console.log(`  - ${path.relative(REPO_ROOT, source)} -> ${path.relative(REPO_ROOT, dest)}`);
    }
  } else {
    console.log("[deps:seed] no legacy assets were copied.");
  }

  if (misses.length) {
    console.log("[deps:seed] assets still missing (add manually):");
    for (const missing of misses) {
      console.log(`  - ${missing}`);
    }
  }
}

main().catch((error) => {
  console.error("[deps:seed] failed:", error.message);
  process.exit(1);
});
