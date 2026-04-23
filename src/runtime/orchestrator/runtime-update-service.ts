import { filesystem, os } from "@neutralinojs/lib";
import { getPlatformName, joinPath } from "./runtime-platform";
import { createDefaultUpdateState, nowIso } from "./runtime-state";
import type { RuntimeStateStore } from "./runtime-state-store";
import type { LatestManifest } from "./runtime-types";

const MANIFEST_BASE_URL = "https://download.relyycast.com/installers/releases";
const UPDATE_DIR = "updates";
const AUTO_CHECK_STARTUP_DELAY_MS = 8_000;

type UpdatePlatform = "macos" | "windows";

function resolveUpdatePlatform(): UpdatePlatform | null {
  const platform = getPlatformName();
  if (platform === "darwin") return "macos";
  if (platform === "windows") return "windows";
  return null;
}

function getCurrentAppVersion(): string {
  // Injected at build time by vite.config.ts via define.
  const v = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "";
  return v || "0.0.0";
}

function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

async function fetchLatestManifest(platform: UpdatePlatform): Promise<LatestManifest> {
  const url = `${MANIFEST_BASE_URL}/${platform}/latest.json`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`manifest fetch failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as unknown;
  if (
    !data
    || typeof data !== "object"
    || typeof (data as Record<string, unknown>).version !== "string"
  ) {
    throw new Error("invalid update manifest");
  }
  return data as LatestManifest;
}

async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class RuntimeUpdateService {
  private stateStore: RuntimeStateStore;
  private autoCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private autoCheckInterval: ReturnType<typeof setInterval> | null = null;
  private downloadInProgress = false;

  constructor(stateStore: RuntimeStateStore) {
    this.stateStore = stateStore;
  }

  startAutoScheduler() {
    // Skip in Vite dev server — no manifest exists and the check noise is unhelpful.
    if (import.meta.env.DEV) return;

    const state = this.stateStore.getRuntimeState();
    if (!state?.config.updatesAutoEnabled) return;

    const intervalMs = (state.config.updatesCheckIntervalHours ?? 24) * 60 * 60 * 1000;

    this.autoCheckTimer = setTimeout(() => {
      void this.checkForUpdates();
    }, AUTO_CHECK_STARTUP_DELAY_MS);

    this.autoCheckInterval = setInterval(() => {
      const current = this.stateStore.getRuntimeState();
      if (current?.config.updatesAutoEnabled) {
        void this.checkForUpdates();
      }
    }, intervalMs);
  }

  stopAutoScheduler() {
    if (this.autoCheckTimer !== null) {
      clearTimeout(this.autoCheckTimer);
      this.autoCheckTimer = null;
    }
    if (this.autoCheckInterval !== null) {
      clearInterval(this.autoCheckInterval);
      this.autoCheckInterval = null;
    }
  }

  async checkForUpdates(): Promise<void> {
    const state = this.stateStore.getRuntimeState();
    if (!state) return;

    const { status } = state.update;
    if (status === "checking" || status === "downloading" || status === "installing") return;

    const platform = resolveUpdatePlatform();
    if (!platform) {
      this.stateStore.updateRuntimeState((current) => {
        current.update.status = "error";
        current.update.lastError = "Automatic updates are not supported on this platform.";
        current.update.lastCheckedAt = nowIso();
      });
      return;
    }

    const currentVersion = getCurrentAppVersion();

    this.stateStore.updateRuntimeState(
      (current) => {
        current.update.status = "checking";
        current.update.currentVersion = currentVersion;
        current.update.lastError = null;
      },
      { persist: false },
    );

    try {
      const manifest = await fetchLatestManifest(platform);
      const checkedAt = nowIso();
      const isNewer = compareSemver(manifest.version, currentVersion) > 0;

      if (!isNewer) {
        this.stateStore.updateRuntimeState((current) => {
          current.update.status = "up-to-date";
          current.update.currentVersion = currentVersion;
          current.update.latestVersion = manifest.version;
          current.update.lastCheckedAt = checkedAt;
          current.update.lastError = null;
          current.update.downloadUrl = null;
          current.update.checksumExpected = null;
        });
        return;
      }

      this.stateStore.updateRuntimeState((current) => {
        current.update.status = "available";
        current.update.currentVersion = currentVersion;
        current.update.latestVersion = manifest.version;
        current.update.lastCheckedAt = checkedAt;
        current.update.lastError = null;
        current.update.downloadUrl = manifest.url;
        current.update.checksumExpected = manifest.sha256 || null;
        current.update.dismissed = false;
      });

      if (state.config.updatesAutoEnabled) {
        void this.downloadUpdate();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.stateStore.updateRuntimeState((current) => {
        current.update.status = "error";
        current.update.lastError = message;
        current.update.lastCheckedAt = nowIso();
      });
    }
  }

  async downloadUpdate(): Promise<void> {
    if (this.downloadInProgress) return;

    const state = this.stateStore.getRuntimeState();
    if (!state) return;

    const { update } = state;

    if (update.status !== "available" && update.status !== "error") return;
    if (!update.downloadUrl) return;

    // Already downloaded and verified — just flip status.
    if (
      update.downloadedInstallerPath
      && update.checksumActual
      && update.checksumExpected
      && update.checksumActual.toLowerCase() === update.checksumExpected.toLowerCase()
    ) {
      this.stateStore.updateRuntimeState(
        (current) => { current.update.status = "ready-to-install"; },
        { persist: false },
      );
      return;
    }

    this.downloadInProgress = true;
    this.stateStore.updateRuntimeState(
      (current) => {
        current.update.status = "downloading";
        current.update.lastError = null;
      },
      { persist: false },
    );

    try {
      const response = await fetch(update.downloadUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`download failed: ${response.status} ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();

      let checksumActual: string | null = null;
      if (update.checksumExpected) {
        checksumActual = await computeSha256Hex(buffer);
        if (checksumActual.toLowerCase() !== update.checksumExpected.toLowerCase()) {
          throw new Error(
            `checksum mismatch: expected ${update.checksumExpected}, got ${checksumActual}`,
          );
        }
      }

      const appDataDir = this.stateStore.getRuntimeAppDataDirectory();
      const updateDir = joinPath(appDataDir, UPDATE_DIR);
      try {
        await filesystem.createDirectory(updateDir);
      } catch {
        // Already exists.
      }

      const fileName = update.downloadUrl.split("/").pop() ?? "update-installer";
      const destPath = joinPath(updateDir, fileName);
      await filesystem.writeBinaryFile(destPath, buffer);

      this.stateStore.updateRuntimeState((current) => {
        current.update.status = "ready-to-install";
        current.update.downloadedInstallerPath = destPath;
        current.update.checksumActual = checksumActual;
        current.update.lastError = null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.stateStore.updateRuntimeState((current) => {
        current.update.status = "error";
        current.update.lastError = message;
      });
    } finally {
      this.downloadInProgress = false;
    }
  }

  async installUpdate(): Promise<void> {
    const state = this.stateStore.getRuntimeState();
    if (!state) throw new Error("runtime state is not initialized");

    const { update } = state;
    if (!update.downloadedInstallerPath) throw new Error("no installer downloaded");

    const platform = resolveUpdatePlatform();
    if (!platform) throw new Error("unsupported platform for installation");

    this.stateStore.updateRuntimeState(
      (current) => { current.update.status = "installing"; },
      { persist: false },
    );

    try {
      if (platform === "macos") {
        await os.open(update.downloadedInstallerPath);
      } else {
        // Windows: launch installer silently in background, then exit.
        await os.execCommand(`"${update.downloadedInstallerPath}"`, { background: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.stateStore.updateRuntimeState((current) => {
        current.update.status = "error";
        current.update.lastError = message;
      });
      throw error;
    }
  }

  dismissUpdateNotice() {
    this.stateStore.updateRuntimeState(
      (current) => { current.update.dismissed = true; },
      { persist: false },
    );
  }

  resetUpdateState() {
    this.stateStore.updateRuntimeState((current) => {
      current.update = createDefaultUpdateState();
    });
  }
}
