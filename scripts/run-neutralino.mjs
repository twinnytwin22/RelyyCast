import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

const APP_URL = process.env.APP_VIEW_URL ?? "http://127.0.0.1:3000";
const APP_WAIT_TIMEOUT_MS = Number(process.env.APP_VIEW_TIMEOUT_MS ?? 60_000);
const LOCAL_NEU_CLI = path.join(
  process.cwd(),
  "node_modules",
  "@neutralinojs",
  "neu",
  "bin",
  "neu.js",
);

const BINARY_BY_PLATFORM = {
  win32: "neutralino-win_x64.exe",
  darwin: "neutralino-mac_x64",
  linux: "neutralino-linux_x64",
};

async function waitForUrl(url, timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return true;
      }
    } catch {
      // Keep waiting for dev server startup.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

async function hasNeutralinoBinary() {
  const binaryName = BINARY_BY_PLATFORM[process.platform];
  if (!binaryName) {
    return false;
  }

  const binaryPath = path.join(process.cwd(), "bin", binaryName);

  try {
    await access(binaryPath);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, args = []) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", () => {
      resolve(1);
    });

    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}

async function runNeu(args) {
  try {
    await access(LOCAL_NEU_CLI);
    return runCommand(process.execPath, [LOCAL_NEU_CLI, ...args]);
  } catch {
    if (process.platform === "win32") {
      return runCommand("cmd.exe", ["/d", "/s", "/c", `npx neu ${args.join(" ")}`]);
    }
    return runCommand("npx", ["neu", ...args]);
  }
}

async function main() {
  console.log(`[neutralino] waiting for ${APP_URL}`);

  const ready = await waitForUrl(APP_URL, APP_WAIT_TIMEOUT_MS);
  if (!ready) {
    console.error(`[neutralino] app did not become ready within ${APP_WAIT_TIMEOUT_MS}ms`);
    process.exit(1);
  }

  const binaryExists = await hasNeutralinoBinary();
  if (!binaryExists) {
    console.log("[neutralino] binary missing, running neu update once...");
    const updateCode = await runNeu(["update"]);
    if (updateCode !== 0) {
      process.exit(updateCode);
    }
  }

  const code = await runNeu(["run"]);
  process.exit(code);
}

main().catch((error) => {
  console.error("[neutralino] failed:", error);
  process.exit(1);
});
