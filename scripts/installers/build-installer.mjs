/**
 * build-installer.mjs — unified installer builder
 *
 * Usage:
 *   node scripts/installers/build-installer.mjs [--skip-sign] [--skip-notarize]
 *
 * On Windows: runs makensis to produce dist/relyycast-setup.exe
 * On macOS:   runs build-pkg.sh to produce dist/RelyyCast.pkg
 *
 * Install prerequisites:
 *   Windows — choco install nsis  OR  download from nsis.sourceforge.io
 *   macOS   — Xcode Command Line Tools (pkgbuild, productbuild, codesign, notarytool all included)
 */

import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR  = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT   = path.resolve(SCRIPT_DIR, "../..");
const DIST_SRC    = path.resolve(REPO_ROOT, "dist", "relyycast");
const WINDOWS_APP_EXE = path.join(DIST_SRC, "relyycast-win_x64.exe");
const WINDOWS_INSTALLER_EXE = path.join(REPO_ROOT, "dist", "relyycast-setup.exe");

const MAC_SIGNING_ENV_KEYS = [
  "APPLE_SIGN_APP",
  "APPLE_SIGN_PKG",
  "APPLE_INSTALLER_CERT_P12",
  "APPLE_INSTALLER_CERT_PASSWORD",
  "APPLE_KEYCHAIN_PATH",
  "APPLE_KEYCHAIN_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_PASSWORD",
  "APPLE_TEAM_ID",
  "NOTARIZE_PROFILE",
];

const WINDOWS_SIGNING_ENV_KEYS = [
  "WINDOWS_SIGNTOOL_PATH",
  "WINDOWS_SIGN_CERT_FILE",
  "WINDOWS_SIGN_CERT_PASSWORD",
  "WINDOWS_SIGN_CERT_SHA1",
  "WINDOWS_SIGN_SUBJECT_NAME",
  "WINDOWS_SIGN_USE_MACHINE_STORE",
  "WINDOWS_SIGN_TIMESTAMP_URL",
  "WINDOWS_SIGN_DIGEST",
];

const INSTALLER_SIGNING_ENV_KEYS = [...MAC_SIGNING_ENV_KEYS, ...WINDOWS_SIGNING_ENV_KEYS];

// Forward flags to sub-scripts
const forwardArgs = process.argv.slice(2);
const SKIP_SIGN      = forwardArgs.includes("--skip-sign");
const SKIP_NOTARIZE  = forwardArgs.includes("--skip-notarize");

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

function formatCmdForLog(command, args = []) {
  const quote = (value) => {
    const text = String(value);
    if (!/[\s"]/g.test(text)) {
      return text;
    }
    return `"${text.replace(/"/g, "\\\"")}"`;
  };
  return [command, ...args].map(quote).join(" ");
}

function runFile(command, args = [], opts = {}) {
  console.log(`\n$ ${formatCmdForLog(command, args)}`);
  execFileSync(command, args, { stdio: "inherit", ...opts });
}

function parseDotenv(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }

    out[key] = value;
  }
  return out;
}

function loadInstallerEnvFiles() {
  const candidates = [
    path.join(REPO_ROOT, ".env.installer.local"),
    path.join(REPO_ROOT, ".env.local"),
    path.join(REPO_ROOT, ".env"),
  ];

  const loadedPaths = [];

  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    const parsed = parseDotenv(readFileSync(envPath, "utf8"));
    let assignedCount = 0;

    for (const key of INSTALLER_SIGNING_ENV_KEYS) {
      if (!process.env[key] && parsed[key]) {
        process.env[key] = parsed[key];
        assignedCount += 1;
      }
    }

    if (assignedCount > 0) {
      loadedPaths.push(`${envPath} (+${assignedCount})`);
    }
  }

  if (loadedPaths.length > 0) {
    console.log(`[installer] Loaded signing env from: ${loadedPaths.join(", ")}`);
  }
}

function maybeLoadSiblingElectronNotaryProfile() {
  if (process.env.NOTARIZE_PROFILE) return;

  const siblingStatePath = path.resolve(REPO_ROOT, "..", "relyy-radio", ".local", "macos-signing.env");
  if (!existsSync(siblingStatePath)) return;

  const state = readFileSync(siblingStatePath, "utf8");
  const profileLine = state
    .split(/\r?\n/)
    .find((line) => line.startsWith("RELYY_SAVED_APPLE_KEYCHAIN_PROFILE="));

  if (!profileLine) return;

  const rawProfile = profileLine.split("=").slice(1).join("=").trim();
  if (!rawProfile) return;

  const profile = rawProfile.replace(/\\ /g, " ").replace(/\\([()"'\\])/g, "$1");
  if (!profile) return;

  process.env.NOTARIZE_PROFILE = profile;
  console.log(`[installer] Reusing notary profile from relyy-radio state: ${profile}`);
}

function parseBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function getWindowsSigningConfig() {
  const certFile = String(process.env.WINDOWS_SIGN_CERT_FILE ?? "").trim();
  const certPassword = String(process.env.WINDOWS_SIGN_CERT_PASSWORD ?? "").trim();
  const certSha1 = String(process.env.WINDOWS_SIGN_CERT_SHA1 ?? "").trim();
  const subjectName = String(process.env.WINDOWS_SIGN_SUBJECT_NAME ?? "").trim();
  const timestampUrl = String(process.env.WINDOWS_SIGN_TIMESTAMP_URL ?? "http://timestamp.digicert.com").trim();
  const digest = String(process.env.WINDOWS_SIGN_DIGEST ?? "SHA256").trim().toUpperCase();
  const useMachineStore = parseBoolean(process.env.WINDOWS_SIGN_USE_MACHINE_STORE);

  const hasIdentity = certFile || certSha1 || subjectName;
  if (!hasIdentity) {
    return null;
  }

  if (certFile && !existsSync(certFile)) {
    throw new Error(`[installer] WINDOWS_SIGN_CERT_FILE does not exist: ${certFile}`);
  }

  return {
    certFile,
    certPassword,
    certSha1,
    subjectName,
    timestampUrl,
    digest,
    useMachineStore,
  };
}

function resolveSignToolPath() {
  const configured = String(process.env.WINDOWS_SIGNTOOL_PATH ?? "").trim();
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(`[installer] WINDOWS_SIGNTOOL_PATH does not exist: ${configured}`);
    }
    return configured;
  }

  const candidates = [
    "signtool",
    "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\x64\\signtool.exe",
    "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\signtool.exe",
    "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22621.0\\x64\\signtool.exe",
    "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22000.0\\x64\\signtool.exe",
    "C:\\Program Files (x86)\\Windows Kits\\10\\App Certification Kit\\signtool.exe",
  ];

  for (const candidate of candidates) {
    try {
      execSync(`"${candidate}" /?`, { stdio: "pipe" });
      return candidate;
    } catch {
      // not found, try next
    }
  }

  throw new Error(
    "[installer] signtool not found. Install Windows SDK signing tools or set WINDOWS_SIGNTOOL_PATH.",
  );
}

function signWindowsFile(signtoolPath, signingConfig, targetPath, label) {
  const args = ["sign", "/v", "/fd", signingConfig.digest];

  if (signingConfig.timestampUrl) {
    args.push("/tr", signingConfig.timestampUrl, "/td", signingConfig.digest);
  }

  if (signingConfig.certFile) {
    args.push("/f", signingConfig.certFile);
    if (signingConfig.certPassword) {
      args.push("/p", signingConfig.certPassword);
    }
  } else {
    if (signingConfig.certSha1) {
      args.push("/sha1", signingConfig.certSha1);
    }
    if (signingConfig.subjectName) {
      args.push("/n", signingConfig.subjectName, "/a");
    }
    if (signingConfig.useMachineStore) {
      args.push("/sm");
    }
  }

  args.push(targetPath);
  console.log(`[installer] Signing ${label}: ${targetPath}`);
  runFile(signtoolPath, args);
}

// -------------------------------------------------------------------------
// Preflight
// -------------------------------------------------------------------------
function checkDistSrc() {
  const required = [
    path.join(DIST_SRC, process.platform === "win32" ? "relyycast-win_x64.exe" : "relyycast-mac_universal"),
    path.join(DIST_SRC, "resources.neu"),
  ];
  for (const f of required) {
    if (!existsSync(f)) {
      console.error(`[installer] Missing required dist file: ${f}`);
      console.error("  Run `npm run neutralino:build` first.");
      process.exit(1);
    }
  }
}

// -------------------------------------------------------------------------
// Windows — NSIS
// -------------------------------------------------------------------------
function buildWindows() {
  const nsiScript = path.join(SCRIPT_DIR, "windows", "relyycast.nsi");
  const signingConfig = SKIP_SIGN ? null : getWindowsSigningConfig();
  let signtoolPath = "";

  if (signingConfig) {
    signtoolPath = resolveSignToolPath();
    signWindowsFile(signtoolPath, signingConfig, WINDOWS_APP_EXE, "app executable");
  } else if (SKIP_SIGN) {
    console.log("[installer] Skipping Windows code signing (--skip-sign).");
  } else {
    console.log("[installer] Windows code signing not configured; building unsigned installer.");
  }

  // Detect makensis on PATH or common install locations
  const candidates = [
    "makensis",
    "C:\\Program Files (x86)\\NSIS\\makensis.exe",
    "C:\\Program Files\\NSIS\\makensis.exe",
  ];

  let makensis = null;
  for (const c of candidates) {
    try {
      execSync(`"${c}" /VERSION`, { stdio: "pipe" });
      makensis = c;
      break;
    } catch {
      // not found, try next
    }
  }

  if (!makensis) {
    console.log("[installer] makensis not found — attempting auto-install via winget...");
    try {
      execSync("winget install NSIS.NSIS --silent --accept-package-agreements --accept-source-agreements", { stdio: "inherit" });
      console.log("[installer] NSIS installed. Retrying...");
    } catch {
      console.error("[installer] winget install failed.");
      console.error("  Install NSIS manually: https://nsis.sourceforge.io/Download");
      console.error("  Or: choco install nsis");
      process.exit(1);
    }

    // Retry after install
    for (const c of candidates) {
      try {
        execSync(`"${c}" /VERSION`, { stdio: "pipe" });
        makensis = c;
        break;
      } catch {
        // still not found
      }
    }

    if (!makensis) {
      console.error("[installer] makensis still not found after install. Try opening a new terminal and re-running.");
      process.exit(1);
    }
  }

  run(`"${makensis}" /V3 "${nsiScript}"`);

  if (signingConfig) {
    signWindowsFile(signtoolPath, signingConfig, WINDOWS_INSTALLER_EXE, "installer");
  }

  console.log("\n[installer] Windows installer: dist\\relyycast-setup.exe");
}

// -------------------------------------------------------------------------
// macOS — build-pkg.sh
// -------------------------------------------------------------------------
function buildMac() {
  const buildPkg = path.join(SCRIPT_DIR, "mac", "build-pkg.sh");

  // Ensure shell script is executable
  run(`chmod +x "${buildPkg}"`);

  const flags = [
    SKIP_SIGN     ? "--skip-sign"      : "",
    SKIP_NOTARIZE ? "--skip-notarize"  : "",
  ].filter(Boolean).join(" ");

  run(`bash "${buildPkg}" ${flags}`.trimEnd());

  console.log("\n[installer] macOS installer: dist/RelyyCast.pkg");
}

// -------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------
console.log("[installer] Checking dist source files...");
checkDistSrc();
loadInstallerEnvFiles();

if (process.platform === "win32") {
  console.log("[installer] Building Windows installer (NSIS)...");
  buildWindows();
} else if (process.platform === "darwin") {
  maybeLoadSiblingElectronNotaryProfile();
  console.log("[installer] Building macOS installer (.pkg)...");
  buildMac();
} else {
  console.error(`[installer] Unsupported platform: ${process.platform}`);
  process.exit(1);
}
