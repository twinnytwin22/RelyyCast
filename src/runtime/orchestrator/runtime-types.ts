import type { CloudflareOnboardingState } from "../cloudflared-onboarding";

export type ManagedProcessName =
  | "mediamtx"
  | "ffmpegIngest"
  | "cloudflared";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "ready-to-install"
  | "installing"
  | "error";

export type UpdateCheckState = {
  status: UpdateStatus;
  currentVersion: string | null;
  latestVersion: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  downloadUrl: string | null;
  downloadedInstallerPath: string | null;
  checksumExpected: string | null;
  checksumActual: string | null;
  dismissed: boolean;
};

export type RuntimeProcessState = {
  running: boolean;
  spawnId: number | null;
  pid: number | null;
  command: string;
  args: string[];
  lastStartAt: string | null;
  lastExitAt: string | null;
  lastExitCode: number | null;
  restartCount: number;
  lastError: string | null;
  lastOutputAt: string | null;
};

export type CloudflareMode = "temporary" | "named";

export type RuntimeConfig = {
  mp3Enabled: boolean;
  inputUrl: string;
  stationName: string;
  genre: string;
  description: string;
  bitrate: string;
  relayPath: string;
  ffmpegPath: string;
  mediamtxPath: string;
  mediamtxConfigPath: string;
  relayRtmpOrigin: string;
  sampleRate: string;
  channels: string;
  cloudflaredPath: string;
  cloudflareMode: CloudflareMode;
  cloudflareTunnelName: string;
  cloudflareHostname: string;
  cloudflareConfigPath: string;
  updatesAutoEnabled: boolean;
  updatesCheckIntervalHours: number;
};

export type RuntimeState = {
  schemaVersion: 1 | 2;
  startedAt: string;
  lastUpdatedAt: string;
  appDataDirectory: string;
  stateFilePath: string;
  phase: "starting" | "running" | "stopping" | "error";
  lastError: string | null;
  config: RuntimeConfig;
  cloudflare: CloudflareOnboardingState;
  processes: Record<ManagedProcessName, RuntimeProcessState>;
  update: UpdateCheckState;
};

export type SpawnedProcessEventDetail = {
  id?: unknown;
  action?: unknown;
  data?: unknown;
};

export type RuntimeWindow = Window & {
  __nlReady?: boolean;
  __relyyNeutralinoReady?: boolean;
  __relyyRuntimeState?: RuntimeState;
};

export type LatestManifest = {
  product: string;
  version: string;
  platform: string;
  fileName: string;
  objectKey: string;
  sha256: string;
  fileSizeBytes: number;
  builtAt: string;
  uploadedAt: string;
  url: string | null;
};

export type ProcessLaunch = {
  executable: string;
  args: string[];
  envs?: Record<string, string>;
};

export type CloudflareOnboardingTrigger = "auto" | "request-login" | "retry";

export type StartManagedProcessOptions = {
  cloudflareTrigger?: CloudflareOnboardingTrigger;
};

export type RuntimeMutationOptions = {
  persist?: boolean;
};

export type ProcessStoppedOptions = {
  clearCommand?: boolean;
  lastError?: string | null;
  lastExitAt?: string | null;
  lastExitCode?: number | null;
};

export const APP_DATA_DIRECTORY_NAME = "relyycast";
export const RUNTIME_STATE_FILE_NAME = "runtime-state.json";
export const DEFAULT_RELAY_RTMP_ORIGIN = "rtmp://127.0.0.1:1935";
export const PROCESS_STOP_TIMEOUT_MS = 2000;

export const PROCESS_START_ORDER: ManagedProcessName[] = [
  "mediamtx",
  "ffmpegIngest",
  "cloudflared",
];

export const PROCESS_RESTART_BACKOFF_MS: Record<ManagedProcessName, number> = {
  mediamtx: 3000,
  ffmpegIngest: 2000,
  cloudflared: 10_000,
};

export const RUNTIME_STATE_EVENT_NAME = "relyycast:runtime-state";
