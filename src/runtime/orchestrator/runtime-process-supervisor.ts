import { os } from "@neutralinojs/lib";
import { applyCloudflareQuickTunnelReadyState, extractQuickTunnelUrl } from "./runtime-cloudflare-adapter";
import { buildLaunchForProcess } from "./runtime-launch-resolvers";
import { buildCommand, getProcessCwd, isWindows, normalizeExecutableForSpawn } from "./runtime-platform";
import {
  nowIso,
  parseExitCode,
  setStoppedProcessState,
  summarizeDetailData,
} from "./runtime-state";
import {
  PROCESS_RESTART_BACKOFF_MS,
  PROCESS_START_ORDER,
  PROCESS_STOP_TIMEOUT_MS,
  type ManagedProcessName,
  type RuntimeMutationOptions,
  type RuntimeState,
  type SpawnedProcessEventDetail,
  type StartManagedProcessOptions,
} from "./runtime-types";

const CLOUDFLARE_LOGIN_RESUME_POLL_MS = 2500;

type ProcessSupervisorDeps = {
  getRuntimeState: () => RuntimeState | null;
  isRuntimeStopping: () => boolean;
  updateRuntimeState: (
    mutator: (current: RuntimeState) => void,
    options?: RuntimeMutationOptions,
  ) => void;
  getRuntimeAppDataDirectory: () => string;
  getMergedProcessEnvs: (overrides?: Record<string, string>) => Promise<Record<string, string> | undefined>;
};

export class RuntimeProcessSupervisor {
  private readonly processBySpawnId = new Map<number, ManagedProcessName>();
  private readonly restartTimers = new Map<ManagedProcessName, number>();
  private cloudflareLoginResumeTimer: number | null = null;

  constructor(private readonly deps: ProcessSupervisorDeps) {}

  private getLaunchContext() {
    return {
      runtimeAppDataDirectory: this.deps.getRuntimeAppDataDirectory(),
      getCurrentCloudflareState: () => this.deps.getRuntimeState()?.cloudflare ?? null,
      applyCloudflareOnboardingState: (cloudflareState: RuntimeState["cloudflare"]) => {
        this.deps.updateRuntimeState((current) => {
          current.cloudflare = cloudflareState;
        });
      },
    };
  }

  private async autoEnableMp3WhenFfmpegDetected() {
    const state = this.deps.getRuntimeState();
    if (!state || state.config.mp3Enabled) {
      return;
    }

    try {
      const ffmpegIngestLaunch = await buildLaunchForProcess(
        "ffmpegIngest",
        state.config,
        this.getLaunchContext(),
      );
      if (!ffmpegIngestLaunch) {
        return;
      }
      this.deps.updateRuntimeState((current) => {
        current.config.mp3Enabled = true;
      });
    } catch {
      // Ignore detection failure and keep current mp3Enabled state.
    }
  }

  cancelRestart(name: ManagedProcessName) {
    this.clearRestartTimer(name);
    if (name === "cloudflared") {
      this.clearCloudflareLoginResumeTimer();
    }
  }

  private clearCloudflareLoginResumeTimer() {
    if (!this.cloudflareLoginResumeTimer) {
      return;
    }
    window.clearTimeout(this.cloudflareLoginResumeTimer);
    this.cloudflareLoginResumeTimer = null;
  }

  private scheduleCloudflareLoginResume() {
    if (this.cloudflareLoginResumeTimer) {
      return;
    }

    this.cloudflareLoginResumeTimer = window.setTimeout(() => {
      this.cloudflareLoginResumeTimer = null;
      void this.startManagedProcess("cloudflared", { cloudflareTrigger: "retry" });
    }, CLOUDFLARE_LOGIN_RESUME_POLL_MS);
  }

  private clearRestartTimer(name: ManagedProcessName) {
    const timer = this.restartTimers.get(name);
    if (!timer) {
      return;
    }
    window.clearTimeout(timer);
    this.restartTimers.delete(name);
  }

  private isManagedProcessEnabled(name: ManagedProcessName, config: RuntimeState["config"]) {
    void name;
    void config;
    return true;
  }

  private shouldRestartManagedProcess(name: ManagedProcessName) {
    const state = this.deps.getRuntimeState();
    if (this.deps.isRuntimeStopping() || !state) {
      return false;
    }
    if (!this.isManagedProcessEnabled(name, state.config)) {
      return false;
    }
    if (name !== "cloudflared") {
      return true;
    }
    return state.cloudflare.status === "ready";
  }

  private scheduleRestart(name: ManagedProcessName, reason: string) {
    if (!this.shouldRestartManagedProcess(name) || this.restartTimers.has(name)) {
      return;
    }

    const backoff = PROCESS_RESTART_BACKOFF_MS[name];
    this.deps.updateRuntimeState((current) => {
      current.processes[name].restartCount += 1;
      current.processes[name].lastError = reason;
    });

    const timer = window.setTimeout(() => {
      this.restartTimers.delete(name);
      void this.startManagedProcess(name);
    }, backoff);

    this.restartTimers.set(name, timer);
  }

  private async terminateSpawnedProcess(id: number) {
    const withTimeout = async (action: "exit" | "kill") => {
      await Promise.race([
        os.updateSpawnedProcess(id, action),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => {
            reject(new Error(`timed out waiting for spawned process ${id} to ${action}`));
          }, PROCESS_STOP_TIMEOUT_MS);
        }),
      ]);
    };

    try {
      await withTimeout("exit");
      return;
    } catch {
      // Fall back for runtimes that expect "kill" instead of "exit".
    }

    try {
      await withTimeout("kill");
    } catch (error) {
      console.warn(`[runtime] failed to stop spawned process ${id}:`, error);
    }
  }

  async startManagedProcess(name: ManagedProcessName, options?: StartManagedProcessOptions) {
    const state = this.deps.getRuntimeState();
    if (this.deps.isRuntimeStopping() || !state) {
      return;
    }

    if (!this.isManagedProcessEnabled(name, state.config)) {
      this.clearRestartTimer(name);
      this.deps.updateRuntimeState((current) => {
        setStoppedProcessState(current.processes[name], {
          clearCommand: true,
          lastError: null,
        });
      });
      return;
    }

    const processState = state.processes[name];
    if (processState.running) {
      return;
    }

    this.clearRestartTimer(name);
    if (name === "cloudflared") {
      this.clearCloudflareLoginResumeTimer();
    }

    try {
      const launch = await buildLaunchForProcess(
        name,
        state.config,
        this.getLaunchContext(),
        options,
      );

      if (!launch) {
        this.deps.updateRuntimeState((current) => {
          setStoppedProcessState(current.processes[name], {
            clearCommand: true,
            ...(name === "cloudflared"
              ? { lastError: current.cloudflare.message }
              : { lastError: null }),
          });
        });

        if (name === "cloudflared") {
          const nextState = this.deps.getRuntimeState();
          if (nextState?.cloudflare.status === "login-required") {
            this.scheduleCloudflareLoginResume();
          }
        }
        return;
      }

      const normalizedExecutable = normalizeExecutableForSpawn(launch.executable);
      const command = buildCommand(normalizedExecutable, launch.args);
      const envs = await this.deps.getMergedProcessEnvs(launch.envs);
      const spawned = await os.spawnProcess(command, {
        cwd: getProcessCwd(),
        ...(envs ? { envs } : {}),
      });

      this.processBySpawnId.set(spawned.id, name);
      this.deps.updateRuntimeState((current) => {
        const target = current.processes[name];
        target.running = true;
        target.spawnId = spawned.id;
        target.pid = spawned.pid;
        target.command = normalizedExecutable;
        target.args = launch.args;
        target.lastStartAt = nowIso();
        target.lastError = null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.updateRuntimeState((current) => {
        setStoppedProcessState(current.processes[name], {
          lastError: message,
          lastExitAt: nowIso(),
          lastExitCode: null,
        });
      });
      if (this.shouldRestartManagedProcess(name)) {
        this.scheduleRestart(name, message);
      }
    }
  }

  async startAllManagedProcesses() {
    await this.autoEnableMp3WhenFfmpegDetected();
    for (const name of PROCESS_START_ORDER) {
      await this.startManagedProcess(name);
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    }
  }

  async stopManagedProcess(name: ManagedProcessName) {
    const state = this.deps.getRuntimeState();
    if (!state) {
      return;
    }

    this.clearRestartTimer(name);
    if (name === "cloudflared") {
      this.clearCloudflareLoginResumeTimer();
    }
    const current = state.processes[name];
    const spawnId = current.spawnId;
    if (typeof spawnId === "number") {
      await this.terminateSpawnedProcess(spawnId);
      this.processBySpawnId.delete(spawnId);
    }

    this.deps.updateRuntimeState((next) => {
      setStoppedProcessState(next.processes[name], {
        lastExitAt: nowIso(),
      });
    });
  }

  async stopAllManagedProcesses() {
    for (const name of PROCESS_START_ORDER) {
      await this.stopManagedProcess(name);
    }
  }

  async cleanupStaleProcesses() {
    const spawned = await os.getSpawnedProcesses().catch(() => []);
    if (!Array.isArray(spawned) || !spawned.length) {
      return;
    }

    for (const process of spawned) {
      if (!process || typeof process.id !== "number") {
        continue;
      }
      await this.terminateSpawnedProcess(process.id);
    }
  }

  async killOrphanedManagedProcesses() {
    if (isWindows()) {
      return;
    }

    const names = ["mediamtx", "cloudflared"];
    for (const name of names) {
      try {
        await os.execCommand(`pkill -f "${name}" 2>/dev/null || true`);
      } catch {
        // Ignore no-match condition.
      }
    }
  }

  handleSpawnedProcessEvent(event: CustomEvent<SpawnedProcessEventDetail>) {
    const detail = event.detail;
    const id = typeof detail?.id === "number" ? detail.id : null;
    const runtimeState = this.deps.getRuntimeState();
    if (id === null || !runtimeState) {
      return;
    }

    const processName = this.processBySpawnId.get(id);
    if (!processName) {
      return;
    }

    const action = typeof detail.action === "string" ? detail.action : "";
    if (action === "stdOut") {
      const stdOutMessage = summarizeDetailData(detail.data);
      this.deps.updateRuntimeState((current) => {
        current.processes[processName].lastOutputAt = nowIso();
        if (processName === "cloudflared") {
          const quickTunnelUrl = extractQuickTunnelUrl(stdOutMessage);
          if (quickTunnelUrl) {
            applyCloudflareQuickTunnelReadyState(current, quickTunnelUrl);
          }
        }
      }, { persist: false });
      return;
    }

    if (action === "stdErr") {
      const stderrMessage = summarizeDetailData(detail.data);
      this.deps.updateRuntimeState((current) => {
        const target = current.processes[processName];
        target.lastOutputAt = nowIso();
        if (stderrMessage) {
          target.lastError = stderrMessage;
        }
        if (processName === "cloudflared") {
          const quickTunnelUrl = extractQuickTunnelUrl(stderrMessage);
          if (quickTunnelUrl) {
            applyCloudflareQuickTunnelReadyState(current, quickTunnelUrl);
          }
        }
      }, { persist: false });
      return;
    }

    if (action !== "exit") {
      return;
    }

    this.processBySpawnId.delete(id);
    const exitCode = parseExitCode(detail.data);
    this.deps.updateRuntimeState((current) => {
      setStoppedProcessState(current.processes[processName], {
        lastExitAt: nowIso(),
        lastExitCode: exitCode,
      });
    });

    if (!this.deps.isRuntimeStopping()) {
      const reason = exitCode === null ? "process exited unexpectedly" : `process exited with code ${exitCode}`;
      this.scheduleRestart(processName, reason);
    }
  }
}
