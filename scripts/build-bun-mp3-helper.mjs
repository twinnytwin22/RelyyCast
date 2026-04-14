import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const ENTRY_FILE = path.resolve(REPO_ROOT, "runtime", "bun-mp3-helper", "src", "main.ts");
const DIST_ROOT = path.resolve(REPO_ROOT, "runtime", "bun-mp3-helper", "dist");

function getBunExecutableCandidates() {
  const candidates = [];

  if (process.env.BUN_BIN?.trim()) {
    candidates.push(process.env.BUN_BIN.trim());
  }

  candidates.push("bun");

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
  }

  return candidates;
}

function parseTargets(argv) {
  const targets = [];
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--target" && argv[i + 1]) {
      targets.push(argv[i + 1]);
      i += 1;
      continue;
    }

    if (current.startsWith("--target=")) {
      const value = current.slice("--target=".length).trim();
      if (value) {
        targets.push(value);
      }
    }
  }
  return targets;
}

function isWindowsTarget(target) {
  return target.toLowerCase().includes("windows");
}

function resolveBunExecutable() {
  const candidates = getBunExecutableCandidates();
  let pathFallback = "bun";

  for (const candidate of candidates) {
    if (candidate === "bun") {
      pathFallback = candidate;
      continue;
    }

    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return pathFallback;
}

function runBunCompile(outfile, target = null) {
  const bunExecutable = resolveBunExecutable();
  const args = ["build", ENTRY_FILE, "--compile", "--outfile", outfile];
  if (target) {
    args.push("--target", target);
  }

  const result = spawnSync(bunExecutable, args, {
    stdio: "inherit",
    cwd: REPO_ROOT,
    env: process.env,
  });

  if (result.error && result.error.code === "ENOENT") {
    throw new Error(
      "Bun executable not found. Install Bun and re-run `npm run mp3-helper:build`.",
    );
  }

  if (result.status !== 0) {
    throw new Error(`bun build failed${target ? ` for target ${target}` : ""}.`);
  }
}

async function compileHostBinary() {
  const extension = process.platform === "win32" ? ".exe" : "";
  const outputDir = path.resolve(DIST_ROOT, "host");
  const outputFile = path.resolve(outputDir, `relyy-mp3-helper${extension}`);
  await mkdir(outputDir, { recursive: true });

  runBunCompile(outputFile);
  return path.relative(REPO_ROOT, outputFile);
}

async function compileTargetBinary(target) {
  const extension = isWindowsTarget(target) ? ".exe" : "";
  const outputDir = path.resolve(DIST_ROOT, target);
  const outputFile = path.resolve(outputDir, `relyy-mp3-helper${extension}`);
  await mkdir(outputDir, { recursive: true });

  runBunCompile(outputFile, target);
  return path.relative(REPO_ROOT, outputFile);
}

async function main() {
  if (!existsSync(ENTRY_FILE)) {
    throw new Error(`Missing Bun helper entry file: ${ENTRY_FILE}`);
  }

  const targets = parseTargets(process.argv.slice(2));
  const outputs = [];

  if (!targets.length) {
    outputs.push(await compileHostBinary());
  } else {
    for (const target of targets) {
      outputs.push(await compileTargetBinary(target));
    }
  }

  console.log(`[mp3-helper] compiled binaries: ${outputs.join(", ")}`);
}

main().catch((error) => {
  console.error("[mp3-helper] build failed:", error.message);
  process.exit(1);
});
