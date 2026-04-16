import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const ENTRY_FILE = path.resolve(REPO_ROOT, "runtime", "bun-mp3-helper", "src", "main.ts");

function getBunExecutableCandidates() {
  const candidates = [];

  if (process.env.BUN_BIN?.trim()) {
    candidates.push(process.env.BUN_BIN.trim());
  }

  if (process.platform === "win32") {
    const userProfile = process.env.USERPROFILE ?? "";
    if (userProfile) {
      candidates.push(path.resolve(userProfile, ".bun", "bin", "bun.exe"));
      candidates.push(
        path.resolve(
          userProfile,
          "AppData",
          "Local",
          "Microsoft",
          "WinGet",
          "Packages",
          "Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe",
          "bun-windows-x64",
          "bun.exe",
        ),
      );
    }

    return candidates;
  }

  const home = process.env.HOME ?? "";
  if (home) {
    candidates.push(path.resolve(home, ".bun", "bin", "bun"));
  }

  candidates.push("/opt/homebrew/bin/bun");
  candidates.push("/usr/local/bin/bun");

  return candidates;
}

function resolveBunExecutable() {
  const candidates = getBunExecutableCandidates();
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  if (process.platform === "win32") {
    return "bun";
  }

  return null;
}

function main() {
  if (!existsSync(ENTRY_FILE)) {
    throw new Error(`Missing Bun helper entry file: ${ENTRY_FILE}`);
  }

  const bunExecutable = resolveBunExecutable();
  if (!bunExecutable) {
    const platform = `${process.platform}/${process.arch}`;
    throw new Error(
      `Bun executable not found for ${platform}. Install Bun or set BUN_BIN to the Bun binary path, then re-run \`npm run mp3-helper:dev\`.`,
    );
  }

  const result = spawnSync(bunExecutable, ["run", ENTRY_FILE], {
    stdio: "inherit",
    cwd: REPO_ROOT,
    env: process.env,
  });

  if (result.error && result.error.code === "ENOENT") {
    const platform = `${process.platform}/${process.arch}`;
    throw new Error(
      `Bun executable not found for ${platform}. Install Bun or set BUN_BIN to the Bun binary path, then re-run \`npm run mp3-helper:dev\`.`,
    );
  }

  process.exit(result.status ?? 1);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[mp3-helper] dev launch failed:", message);
  process.exit(1);
}
