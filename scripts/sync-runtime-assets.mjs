import path from "node:path";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const BUILD_ROOT = path.resolve(REPO_ROOT, "build");
const BUILD_MEDIAMTX_ROOT = path.resolve(BUILD_ROOT, "mediamtx");

function getPlatformAssetFolders() {
  if (process.platform === "win32") {
    return ["win"];
  }

  if (process.platform === "darwin") {
    return ["mac"];
  }

  return [];
}

async function copyIfPresent(sourcePath, destinationPath) {
  if (!existsSync(sourcePath)) {
    return false;
  }

  await cp(sourcePath, destinationPath, { recursive: true });
  return true;
}

async function main() {
  await mkdir(BUILD_ROOT, { recursive: true });
  await rm(BUILD_MEDIAMTX_ROOT, { recursive: true, force: true });
  await mkdir(BUILD_MEDIAMTX_ROOT, { recursive: true });

  const copiedTargets = [];
  const configSourcePath = path.resolve(REPO_ROOT, "mediamtx", "mediamtx.yml");
  const configDestinationPath = path.resolve(BUILD_MEDIAMTX_ROOT, "mediamtx.yml");

  if (await copyIfPresent(configSourcePath, configDestinationPath)) {
    copiedTargets.push(path.relative(REPO_ROOT, configDestinationPath));
  }

  for (const folderName of getPlatformAssetFolders()) {
    const sourcePath = path.resolve(REPO_ROOT, "mediamtx", folderName);
    const destinationPath = path.resolve(BUILD_MEDIAMTX_ROOT, folderName);

    if (await copyIfPresent(sourcePath, destinationPath)) {
      copiedTargets.push(path.relative(REPO_ROOT, destinationPath));
    }
  }

  const macBinaryPath = path.resolve(BUILD_MEDIAMTX_ROOT, "mac", "mediamtx");
  if (process.platform !== "win32" && existsSync(macBinaryPath)) {
    await chmod(macBinaryPath, 0o755);
  }

  if (!copiedTargets.length) {
    console.log("[build] no MediaMTX runtime assets were staged.");
    return;
  }

  console.log(`[build] staged MediaMTX runtime assets: ${copiedTargets.join(", ")}`);
}

main().catch((error) => {
  console.error("[build] failed to stage MediaMTX runtime assets:", error);
  process.exit(1);
});