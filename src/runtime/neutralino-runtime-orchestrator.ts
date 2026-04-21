import {
  app,
  events,
  os,
  window as nlWindow,
} from "@neutralinojs/lib";
import { RuntimeProcessSupervisor } from "./orchestrator/runtime-process-supervisor";
import {
  normalizeRuntimeConfig,
  nowIso,
  setStoppedProcessState,
} from "./orchestrator/runtime-state";
import { RuntimeStateStore } from "./orchestrator/runtime-state-store";
import { getPlatformName } from "./orchestrator/runtime-platform";
import { showTrayCloseHintOnce } from "./tray-close-hint";
import {
  RUNTIME_STATE_EVENT_NAME,
  type RuntimeConfig,
  type SpawnedProcessEventDetail,
} from "./orchestrator/runtime-types";

export type {
  ManagedProcessName,
  RuntimeProcessState,
  CloudflareMode,
  RuntimeConfig,
  RuntimeState,
} from "./orchestrator/runtime-types";

export { RUNTIME_STATE_EVENT_NAME };

const stateStore = new RuntimeStateStore();

let runtimeStartPromise: Promise<void> | null = null;
let runtimeStopping = false;
let listenersBound = false;
let appExitRequested = false;
let trayInitialized = false;

const TRAY_ITEM_SHOW = "show";
const TRAY_ITEM_HIDE = "hide";
const TRAY_ITEM_EXIT = "exit";
const DEFAULT_TRAY_ICON = "/favicon.ico";
const MACOS_TRAY_ICON_LIGHT_MODE = "/tray_icon_dark_20.png";
const MACOS_TRAY_ICON_DARK_MODE = "/tray_icon_light_20.png";

type TrayMenuItemClickedDetail = {
  id?: unknown;
  text?: unknown;
};

const processSupervisor = new RuntimeProcessSupervisor({
  getRuntimeState: () => stateStore.getRuntimeState(),
  isRuntimeStopping: () => runtimeStopping,
  updateRuntimeState: (mutator, options) => stateStore.updateRuntimeState(mutator, options),
  getRuntimeAppDataDirectory: () => stateStore.getRuntimeAppDataDirectory(),
  getMergedProcessEnvs: (overrides) => stateStore.getMergedProcessEnvs(overrides),
});

function parseTrayItemId(detail: TrayMenuItemClickedDetail | undefined) {
  if (!detail) {
    return "";
  }

  if (typeof detail.id === "string" && detail.id.trim().length > 0) {
    return detail.id.trim().toLowerCase();
  }

  if (typeof detail.text === "string" && detail.text.trim().length > 0) {
    return detail.text.trim().toLowerCase();
  }

  return "";
}

async function showMainWindow() {
  try {
    await nlWindow.show();
    await nlWindow.focus();
  } catch (error) {
    console.warn("[runtime] failed to show main window from tray:", error);
  }
}

async function hideMainWindow() {
  try {
    await nlWindow.hide();
  } catch (error) {
    console.warn("[runtime] failed to hide main window to tray:", error);
  }
}

function getTrayMenuItems() {
  return [
    { id: TRAY_ITEM_SHOW, text: "Show App" },
    { id: TRAY_ITEM_HIDE, text: "Hide App" },
    { id: TRAY_ITEM_EXIT, text: "Exit" },
  ];
}

function prefersDarkColorScheme() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getMacTrayIconPath() {
  return prefersDarkColorScheme() ? MACOS_TRAY_ICON_DARK_MODE : MACOS_TRAY_ICON_LIGHT_MODE;
}

async function setupTrayMenu() {
  if (trayInitialized) {
    return;
  }

  const isMac = getPlatformName() === "darwin";
  const trayIconPath = isMac ? getMacTrayIconPath() : DEFAULT_TRAY_ICON;

  try {
    await os.setTray({
      icon: trayIconPath,
      menuItems: getTrayMenuItems(),
    });
    trayInitialized = true;
  } catch (error) {
    if (isMac) {
      try {
        await os.setTray({
          icon: DEFAULT_TRAY_ICON,
          menuItems: getTrayMenuItems(),
        });
        trayInitialized = true;
        return;
      } catch (fallbackError) {
        console.warn("[runtime] fallback tray icon initialization failed:", fallbackError);
      }
    }
    console.warn("[runtime] failed to initialize tray menu:", error);
  }
}

async function requestApplicationExit(reason: string) {
  if (appExitRequested) {
    return;
  }
  appExitRequested = true;

  try {
    await stopRuntimeOrchestration(reason);
  } finally {
    try {
      await app.exit();
    } catch (error) {
      console.error("[runtime] failed to exit app:", error);
      appExitRequested = false;
    }
  }
}

function bindRuntimeListeners() {
  if (listenersBound) {
    return;
  }
  listenersBound = true;

  void setupTrayMenu();

  void events.on(
    "spawnedProcess",
    ((event: CustomEvent) => {
      processSupervisor.handleSpawnedProcessEvent(event as CustomEvent<SpawnedProcessEventDetail>);
    }) as unknown as (event: CustomEvent) => void,
  );
  void events.on(
    "trayMenuItemClicked",
    ((event: CustomEvent) => {
      const detail = event.detail as TrayMenuItemClickedDetail | undefined;
      const menuItemId = parseTrayItemId(detail);

      if (menuItemId === TRAY_ITEM_SHOW || menuItemId === "show app") {
        void showMainWindow();
        return;
      }
      if (menuItemId === TRAY_ITEM_HIDE || menuItemId === "hide app") {
        void hideMainWindow();
        return;
      }
      if (menuItemId === TRAY_ITEM_EXIT || menuItemId === "quit") {
        void requestApplicationExit("tray-exit");
      }
    }) as unknown as (event: CustomEvent) => void,
  );
  void events.on(
    "windowClose",
    ((event: CustomEvent) => {
      event.preventDefault();
      void hideMainWindow();
      void showTrayCloseHintOnce();
    }) as unknown as (event: CustomEvent) => void,
  );

  window.addEventListener("beforeunload", () => {
    void stopRuntimeOrchestration("beforeunload");
  });
}

export async function stopRuntimeOrchestration(reason: string) {
  if (!stateStore.getRuntimeState() || runtimeStopping) {
    return;
  }

  runtimeStopping = true;
  stateStore.updateRuntimeState((current) => {
    current.phase = "stopping";
    current.lastError = reason;
  });

  await processSupervisor.stopAllManagedProcesses();
}

async function startRuntimeOrchestrationInternal() {
  const ready = await stateStore.ensureNeutralinoReady();
  if (!ready) {
    return;
  }

  runtimeStopping = false;
  bindRuntimeListeners();

  await stateStore.initializeRuntimeState();

  await processSupervisor.cleanupStaleProcesses();
  await processSupervisor.killOrphanedManagedProcesses();
  await processSupervisor.startAllManagedProcesses();

  stateStore.updateRuntimeState((current) => {
    current.phase = "running";
    current.lastError = null;
  });
}

export function ensureRuntimeOrchestrationStarted() {
  if (runtimeStartPromise) {
    return runtimeStartPromise;
  }

  runtimeStartPromise = startRuntimeOrchestrationInternal().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[runtime] orchestration failed:", error);
    if (stateStore.getRuntimeState()) {
      stateStore.updateRuntimeState((current) => {
        current.phase = "error";
        current.lastError = message;
      });
    }
    runtimeStartPromise = null;
    throw error;
  });

  return runtimeStartPromise;
}

async function restartManagedProcessesForConfigUpdate() {
  if (!stateStore.getRuntimeState() || runtimeStopping) {
    return;
  }

  runtimeStopping = true;
  stateStore.updateRuntimeState((current) => {
    current.phase = "starting";
  });

  try {
    await processSupervisor.stopAllManagedProcesses();
  } finally {
    runtimeStopping = false;
  }

  await processSupervisor.startAllManagedProcesses();
  stateStore.updateRuntimeState((current) => {
    current.phase = "running";
    current.lastError = null;
  });
}

async function runCloudflareSetupAction(trigger: "request-login" | "retry") {
  const runtimeState = stateStore.getRuntimeState();
  if (!runtimeState) {
    throw new Error("runtime state is not initialized");
  }
  if (runtimeStopping) {
    throw new Error("runtime is stopping");
  }

  const startedAt = nowIso();
  stateStore.updateRuntimeState((current) => {
    current.cloudflare.status = "provisioning";
    current.cloudflare.message =
      trigger === "retry"
        ? "Retrying Cloudflare setup. Finish any browser step if prompted."
        : "Cloudflare setup in progress. Finish any browser step if prompted.";
    current.cloudflare.requiresUserAction = false;
    current.cloudflare.loginRequired = false;
    current.cloudflare.nextAction = "none";
    current.cloudflare.canRetry = false;
    current.cloudflare.lastAttemptAt = startedAt;
    current.cloudflare.lastCheckedAt = startedAt;
    current.processes.cloudflared.lastError = null;
  });

  processSupervisor.cancelRestart("cloudflared");
  if (runtimeState.processes.cloudflared.running) {
    await processSupervisor.stopManagedProcess("cloudflared");
  }

  await processSupervisor.startManagedProcess("cloudflared", { cloudflareTrigger: trigger });
  return getRuntimeStateSnapshot();
}

export async function requestCloudflareLogin() {
  return runCloudflareSetupAction("request-login");
}

export async function retryCloudflareSetup() {
  return runCloudflareSetupAction("retry");
}

export async function skipCloudflareForNow() {
  const runtimeState = stateStore.getRuntimeState();
  if (!runtimeState) {
    throw new Error("runtime state is not initialized");
  }
  if (runtimeStopping) {
    throw new Error("runtime is stopping");
  }

  processSupervisor.cancelRestart("cloudflared");
  if (runtimeState.processes.cloudflared.running) {
    await processSupervisor.stopManagedProcess("cloudflared");
  }

  const skippedAt = nowIso();
  stateStore.updateRuntimeState((current) => {
    current.cloudflare.status = "pending-consent";
    current.cloudflare.message = "Cloudflare setup skipped for now. Local mode remains active.";
    current.cloudflare.hostname = null;
    current.cloudflare.publicUrl = null;
    current.cloudflare.tunnelId = null;
    current.cloudflare.loginRequired = false;
    current.cloudflare.requiresUserAction = true;
    current.cloudflare.nextAction = "connect-cloudflare";
    current.cloudflare.canRetry = false;
    current.cloudflare.lastUserPromptAt = skippedAt;
    current.cloudflare.lastAttemptAt = skippedAt;
    current.cloudflare.lastCheckedAt = skippedAt;

    setStoppedProcessState(current.processes.cloudflared, {
      clearCommand: true,
      lastError: current.cloudflare.message,
    });
  });

  return getRuntimeStateSnapshot();
}

export function getRuntimeStateSnapshot() {
  return stateStore.getRuntimeStateSnapshot();
}

export async function getPersistedRuntimeStateSnapshot() {
  return stateStore.getPersistedRuntimeStateSnapshot();
}

export async function updateRuntimeConfig(input: Partial<RuntimeConfig>) {
  const runtimeState = stateStore.getRuntimeState();
  if (!runtimeState) {
    throw new Error("runtime state is not initialized");
  }
  if (runtimeStopping) {
    throw new Error("runtime is stopping");
  }

  const nextConfig = normalizeRuntimeConfig({
    ...runtimeState.config,
    ...input,
  });
  const previousSerialized = JSON.stringify(runtimeState.config);
  const nextSerialized = JSON.stringify(nextConfig);
  if (previousSerialized === nextSerialized) {
    return getRuntimeStateSnapshot();
  }

  stateStore.updateRuntimeState((current) => {
    current.config = nextConfig;
  });

  if (runtimeState.phase === "running") {
    await restartManagedProcessesForConfigUpdate();
  }

  return getRuntimeStateSnapshot();
}
