import { events } from "@neutralinojs/lib";
import { RuntimeProcessSupervisor } from "./orchestrator/runtime-process-supervisor";
import {
  normalizeRuntimeConfig,
  nowIso,
  setStoppedProcessState,
} from "./orchestrator/runtime-state";
import { RuntimeStateStore } from "./orchestrator/runtime-state-store";
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

const processSupervisor = new RuntimeProcessSupervisor({
  getRuntimeState: () => stateStore.getRuntimeState(),
  isRuntimeStopping: () => runtimeStopping,
  updateRuntimeState: (mutator, options) => stateStore.updateRuntimeState(mutator, options),
  getRuntimeAppDataDirectory: () => stateStore.getRuntimeAppDataDirectory(),
  getMergedProcessEnvs: (overrides) => stateStore.getMergedProcessEnvs(overrides),
});

function bindRuntimeListeners() {
  if (listenersBound) {
    return;
  }
  listenersBound = true;

  void events.on(
    "spawnedProcess",
    ((event: CustomEvent) => {
      processSupervisor.handleSpawnedProcessEvent(event as CustomEvent<SpawnedProcessEventDetail>);
    }) as unknown as (event: CustomEvent) => void,
  );
  void events.on("windowClose", () => {
    void stopRuntimeOrchestration("windowClose");
  });

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
