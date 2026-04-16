import {
  filesystem,
  init as nlInit,
  os,
} from "@neutralinojs/lib";
import { hasNeutralinoGlobals, joinPath } from "./runtime-platform";
import {
  cloneRuntimeState,
  createRuntimeStateTemplate,
  mergePersistedCloudflareState,
  mergePersistedProcessState,
  normalizeRuntimeConfig,
  nowIso,
} from "./runtime-state";
import {
  APP_DATA_DIRECTORY_NAME,
  PROCESS_START_ORDER,
  RUNTIME_STATE_EVENT_NAME,
  RUNTIME_STATE_FILE_NAME,
  type ManagedProcessName,
  type RuntimeMutationOptions,
  type RuntimeState,
  type RuntimeWindow,
} from "./runtime-types";

export class RuntimeStateStore {
  private neutralinoInitStarted = false;
  private neutralinoReadyPromise: Promise<boolean> | null = null;

  private runtimeState: RuntimeState | null = null;
  private runtimeStatePath = "";
  private runtimeAppDataDirectory = "";
  private persistQueue: Promise<void> = Promise.resolve();
  private cachedProcessEnvs: Record<string, string> | null = null;

  getRuntimeState() {
    return this.runtimeState;
  }

  getRuntimeAppDataDirectory() {
    return this.runtimeAppDataDirectory;
  }

  async ensureNeutralinoReady() {
    if (typeof window === "undefined" || !hasNeutralinoGlobals()) {
      return false;
    }

    const runtimeWindow = window as RuntimeWindow;
    if (runtimeWindow.__relyyNeutralinoReady || runtimeWindow.__nlReady) {
      runtimeWindow.__relyyNeutralinoReady = true;
      return true;
    }

    if (this.neutralinoReadyPromise) {
      return this.neutralinoReadyPromise;
    }

    this.neutralinoReadyPromise = new Promise<boolean>((resolve) => {
      let settled = false;

      const finalize = (value: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        if (value) {
          runtimeWindow.__relyyNeutralinoReady = true;
        }
        window.removeEventListener("ready", onReady as EventListener);
        resolve(value);
      };

      const onReady = () => finalize(true);

      window.addEventListener("ready", onReady as EventListener, { once: true });

      window.setTimeout(() => {
        finalize(Boolean(runtimeWindow.__relyyNeutralinoReady || runtimeWindow.__nlReady));
      }, 10_000);

      try {
        if (!this.neutralinoInitStarted) {
          this.neutralinoInitStarted = true;
          nlInit();
        }
        if (typeof window.NL_CVERSION === "string" && window.NL_CVERSION.length > 0) {
          finalize(true);
        }
      } catch (error) {
        console.error("[runtime] Neutralino init failed:", error);
        finalize(false);
      }
    });

    return this.neutralinoReadyPromise;
  }

  updateRuntimeState(
    mutator: (current: RuntimeState) => void,
    options?: RuntimeMutationOptions,
  ) {
    if (!this.runtimeState) {
      return;
    }
    mutator(this.runtimeState);
    this.runtimeState.lastUpdatedAt = nowIso();
    this.publishRuntimeState();
    if (options?.persist !== false) {
      this.schedulePersistRuntimeState();
    }
  }

  publishRuntimeState() {
    if (!this.runtimeState || typeof window === "undefined") {
      return;
    }
    const runtimeWindow = window as RuntimeWindow;
    const snapshot = cloneRuntimeState(this.runtimeState);
    runtimeWindow.__relyyRuntimeState = snapshot;
    window.dispatchEvent(
      new CustomEvent(RUNTIME_STATE_EVENT_NAME, {
        detail: snapshot,
      }),
    );
  }

  getRuntimeStateSnapshot() {
    if (!this.runtimeState) {
      return null;
    }
    return cloneRuntimeState(this.runtimeState);
  }

  async getPersistedRuntimeStateSnapshot() {
    const ready = await this.ensureNeutralinoReady();
    if (!ready) {
      return this.getRuntimeStateSnapshot();
    }

    if (!this.runtimeStatePath) {
      await this.resolveRuntimeStatePath();
    }

    try {
      const raw = await filesystem.readFile(this.runtimeStatePath);
      return JSON.parse(raw) as RuntimeState;
    } catch {
      return this.getRuntimeStateSnapshot();
    }
  }

  async getMergedProcessEnvs(overrides?: Record<string, string>) {
    if (!overrides) {
      return undefined;
    }

    if (!this.cachedProcessEnvs) {
      this.cachedProcessEnvs = await os.getEnvs().catch(() => ({} as Record<string, string>));
    }

    return {
      ...this.cachedProcessEnvs,
      ...overrides,
    };
  }

  async initializeRuntimeState() {
    await this.resolveRuntimeStatePath();
    this.runtimeState = await this.loadRuntimeState();
    this.publishRuntimeState();
    this.schedulePersistRuntimeState();
  }

  private schedulePersistRuntimeState() {
    if (!this.runtimeStatePath || !this.runtimeState) {
      return;
    }
    const payload = `${JSON.stringify(this.runtimeState, null, 2)}\n`;
    this.persistQueue = this.persistQueue
      .then(() => filesystem.writeFile(this.runtimeStatePath, payload))
      .catch((error: unknown) => {
        console.error("[runtime] failed to persist runtime state:", error);
      });
  }

  private async resolveRuntimeStatePath() {
    const dataRoot = await os.getPath("data");
    this.runtimeAppDataDirectory = joinPath(dataRoot, APP_DATA_DIRECTORY_NAME);
    this.runtimeStatePath = joinPath(this.runtimeAppDataDirectory, RUNTIME_STATE_FILE_NAME);

    try {
      await filesystem.createDirectory(this.runtimeAppDataDirectory);
    } catch {
      // Directory already exists.
    }
  }

  private async loadRuntimeState() {
    const base = createRuntimeStateTemplate(this.runtimeAppDataDirectory, this.runtimeStatePath);

    try {
      const raw = await filesystem.readFile(this.runtimeStatePath);
      const parsed = JSON.parse(raw) as Partial<RuntimeState>;

      base.config = normalizeRuntimeConfig(parsed.config);
      base.cloudflare = mergePersistedCloudflareState(base.cloudflare, parsed.cloudflare);
      base.phase = "starting";
      base.lastError = typeof parsed.lastError === "string" ? parsed.lastError : null;
      const persistedProcesses = parsed.processes && typeof parsed.processes === "object"
        ? (parsed.processes as Partial<Record<ManagedProcessName, unknown>>)
        : {};
      for (const processName of PROCESS_START_ORDER) {
        base.processes[processName] = mergePersistedProcessState(
          base.processes[processName],
          persistedProcesses[processName],
        );
      }
    } catch {
      // Use defaults if no previous state is found.
    }

    return base;
  }
}
