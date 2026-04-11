import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const APP_URL = process.env.APP_VIEW_URL ?? "http://127.0.0.1:3000";
const APP_WAIT_TIMEOUT_MS = Number(process.env.APP_VIEW_TIMEOUT_MS ?? 60_000);
const APP_VIEW_USER_DATA_DIR = process.env.APP_VIEW_USER_DATA_DIR ?? path.join(os.tmpdir(), "relyycast-app-view-profile");
const APP_VIEW_WIDTH = Number(process.env.APP_VIEW_WIDTH ?? 1024);
const APP_VIEW_HEIGHT = Number(process.env.APP_VIEW_HEIGHT ?? 500);

const WINDOWS_BROWSER_PATHS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

async function canAccess(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return true;
      }
    } catch {
      // App is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

function openInWindowsAppMode(url, browserExecutable) {
  // Launch browser executable directly to avoid cmd/start quoting edge-cases.
  const args = [
    `--app=${url}`,
    "--new-window",
    `--window-size=${APP_VIEW_WIDTH},${APP_VIEW_HEIGHT}`,
    `--user-data-dir=${APP_VIEW_USER_DATA_DIR}`,
  ];

  spawn(browserExecutable, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

function openInDefaultBrowser(url) {
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }

  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

async function main() {
  console.log(`[app-view] waiting for ${APP_URL}`);

  const ready = await waitForUrl(APP_URL, APP_WAIT_TIMEOUT_MS);
  if (!ready) {
    console.error(`[app-view] app did not become ready within ${APP_WAIT_TIMEOUT_MS}ms`);
    process.exit(1);
  }

  if (process.platform === "win32") {
    console.log(`[app-view] launch size ${APP_VIEW_WIDTH}x${APP_VIEW_HEIGHT}`);
    console.warn("[app-view] Browser app-mode cannot strictly lock resize/fullscreen. Use a native shell (Neutralino/Tauri) for hard window constraints.");
    for (const candidate of WINDOWS_BROWSER_PATHS) {
      if (await canAccess(candidate)) {
        openInWindowsAppMode(APP_URL, candidate);
        console.log(`[app-view] opened app window with ${candidate}`);
        return;
      }
    }

    console.warn("[app-view] Edge/Chrome not found in standard locations; opening default browser instead.");
    openInDefaultBrowser(APP_URL);
    return;
  }
  console.warn("[app-view] App mode launch is currently optimized for Windows; opening default browser.");
  openInDefaultBrowser(APP_URL);
}

main().catch((error) => {
  console.error("[app-view] failed:", error);
  process.exit(1);
});
