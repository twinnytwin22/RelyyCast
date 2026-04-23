import type { CloudflareOnboardingState } from "../cloudflared-onboarding";
import {
  DEFAULT_RELAY_RTMP_ORIGIN,
  type CloudflareMode,
  type ProcessStoppedOptions,
  type RuntimeConfig,
  type RuntimeProcessState,
  type RuntimeState,
  type UpdateCheckState,
} from "./runtime-types";

export function nowIso() {
  return new Date().toISOString();
}

function createProcessState(): RuntimeProcessState {
  return {
    running: false,
    spawnId: null,
    pid: null,
    command: "",
    args: [],
    lastStartAt: null,
    lastExitAt: null,
    lastExitCode: null,
    restartCount: 0,
    lastError: null,
    lastOutputAt: null,
  };
}

export function cloneRuntimeState(state: RuntimeState): RuntimeState {
  return JSON.parse(JSON.stringify(state)) as RuntimeState;
}

function createDefaultConfig(): RuntimeConfig {
  return {
    mp3Enabled: false,
    inputUrl: "http://127.0.0.1:4850/live.mp3",
    stationName: "",
    genre: "Various",
    description: "Local FFmpeg test source",
    bitrate: "128k",
    relayPath: "live",
    ffmpegPath: "",
    mediamtxPath: "",
    mediamtxConfigPath: "",
    relayRtmpOrigin: DEFAULT_RELAY_RTMP_ORIGIN,
    sampleRate: "44100",
    channels: "2",
    cloudflaredPath: "",
    cloudflareMode: "named",
    cloudflareTunnelName: "",
    cloudflareHostname: "",
    cloudflareConfigPath: "",
    updatesAutoEnabled: true,
    updatesCheckIntervalHours: 24,
  };
}

export function createDefaultUpdateState(): UpdateCheckState {
  return {
    status: "idle",
    currentVersion: null,
    latestVersion: null,
    lastCheckedAt: null,
    lastError: null,
    downloadUrl: null,
    downloadedInstallerPath: null,
    checksumExpected: null,
    checksumActual: null,
    dismissed: false,
  };
}

function createDefaultCloudflareState(): CloudflareOnboardingState {
  return {
    status: "pending-consent",
    setupStage: "idle",
    message: null,
    binaryPath: null,
    appDirectory: null,
    tunnelName: null,
    tunnelId: null,
    hostname: null,
    publicUrl: null,
    certPath: null,
    credentialsPath: null,
    configPath: null,
    loginRequired: false,
    dnsRouted: false,
    dnsJustProvisioned: false,
    requiresUserAction: true,
    nextAction: "connect-cloudflare",
    canRetry: false,
    lastUserPromptAt: null,
    lastAttemptAt: null,
    lastCheckedAt: null,
  };
}

export function createRuntimeStateTemplate(appDataDirectory: string, stateFilePath: string): RuntimeState {
  return {
    schemaVersion: 2,
    startedAt: nowIso(),
    lastUpdatedAt: nowIso(),
    appDataDirectory,
    stateFilePath,
    phase: "starting",
    lastError: null,
    config: createDefaultConfig(),
    cloudflare: createDefaultCloudflareState(),
    processes: {
      mediamtx: createProcessState(),
      ffmpegIngest: createProcessState(),
      cloudflared: createProcessState(),
    },
    update: createDefaultUpdateState(),
  };
}

export function normalizeExecutablePath(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/^"(.*)"$/, "$1");
}

export function sanitizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/[\r\n]/g, " ").slice(0, maxLength).trim();
}

export function normalizeRelayPath(value: unknown) {
  if (typeof value !== "string") {
    return "live";
  }
  const relayPath = value.trim().replace(/^\/+|\/+$/g, "");
  if (!relayPath || relayPath.includes("..")) {
    return "live";
  }
  if (!/^[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/.test(relayPath)) {
    return "live";
  }
  return relayPath;
}

export function normalizePort(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeCloudflareMode(value: unknown): CloudflareMode {
  if (value === "temporary" || value === "named") {
    return value;
  }
  return "named";
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

export function normalizeRuntimeConfig(source: unknown): RuntimeConfig {
  const input = source && typeof source === "object" ? (source as Partial<RuntimeConfig>) : {};
  const base = createDefaultConfig();
  const cloudflareHostname = sanitizeText(input.cloudflareHostname, 220) || base.cloudflareHostname;

  const updatesCheckIntervalHours =
    typeof input.updatesCheckIntervalHours === "number"
    && Number.isFinite(input.updatesCheckIntervalHours)
    && input.updatesCheckIntervalHours >= 1
      ? Math.floor(input.updatesCheckIntervalHours)
      : base.updatesCheckIntervalHours;

  return {
    mp3Enabled: normalizeBoolean(input.mp3Enabled, base.mp3Enabled),
    inputUrl: sanitizeText(input.inputUrl, 500) || base.inputUrl,
    stationName: sanitizeText(input.stationName, 120) || base.stationName,
    genre: sanitizeText(input.genre, 120) || base.genre,
    description: sanitizeText(input.description, 180) || base.description,
    bitrate: sanitizeText(input.bitrate, 24) || base.bitrate,
    relayPath: normalizeRelayPath(input.relayPath),
    ffmpegPath: normalizeExecutablePath(input.ffmpegPath),
    mediamtxPath: normalizeExecutablePath(input.mediamtxPath),
    mediamtxConfigPath: normalizeExecutablePath(input.mediamtxConfigPath),
    relayRtmpOrigin: sanitizeText(input.relayRtmpOrigin, 240) || base.relayRtmpOrigin,
    sampleRate: sanitizeText(input.sampleRate, 12) || base.sampleRate,
    channels: sanitizeText(input.channels, 4) || base.channels,
    cloudflaredPath: normalizeExecutablePath(input.cloudflaredPath),
    cloudflareMode: normalizeCloudflareMode(input.cloudflareMode),
    cloudflareTunnelName: sanitizeText(input.cloudflareTunnelName, 120) || base.cloudflareTunnelName,
    cloudflareHostname,
    cloudflareConfigPath: normalizeExecutablePath(input.cloudflareConfigPath),
    updatesAutoEnabled: normalizeBoolean(input.updatesAutoEnabled, base.updatesAutoEnabled),
    updatesCheckIntervalHours,
  };
}

export function mergePersistedUpdateState(
  base: UpdateCheckState,
  source: unknown,
): UpdateCheckState {
  const input = source && typeof source === "object" ? (source as Partial<UpdateCheckState>) : {};

  const isValidUpdateStatus = (v: unknown): v is UpdateCheckState["status"] =>
    v === "idle" || v === "checking" || v === "up-to-date" || v === "available"
    || v === "downloading" || v === "downloaded" || v === "ready-to-install"
    || v === "installing" || v === "error";

  return {
    status: isValidUpdateStatus(input.status) ? input.status : base.status,
    currentVersion: typeof input.currentVersion === "string" ? input.currentVersion : base.currentVersion,
    latestVersion: typeof input.latestVersion === "string" ? input.latestVersion : base.latestVersion,
    lastCheckedAt: typeof input.lastCheckedAt === "string" ? input.lastCheckedAt : base.lastCheckedAt,
    lastError: typeof input.lastError === "string" ? input.lastError : base.lastError,
    downloadUrl: typeof input.downloadUrl === "string" ? input.downloadUrl : base.downloadUrl,
    downloadedInstallerPath:
      typeof input.downloadedInstallerPath === "string"
        ? input.downloadedInstallerPath
        : base.downloadedInstallerPath,
    checksumExpected:
      typeof input.checksumExpected === "string" ? input.checksumExpected : base.checksumExpected,
    checksumActual:
      typeof input.checksumActual === "string" ? input.checksumActual : base.checksumActual,
    dismissed: false,
  };
}

export function mergePersistedProcessState(
  base: RuntimeProcessState,
  source: unknown,
): RuntimeProcessState {
  const input = source && typeof source === "object" ? (source as Partial<RuntimeProcessState>) : {};
  return {
    ...base,
    running: false,
    spawnId: null,
    pid: null,
    command: typeof input.command === "string" ? input.command : base.command,
    args: Array.isArray(input.args) ? input.args.filter((value): value is string => typeof value === "string") : base.args,
    lastStartAt: typeof input.lastStartAt === "string" ? input.lastStartAt : base.lastStartAt,
    lastExitAt: typeof input.lastExitAt === "string" ? input.lastExitAt : base.lastExitAt,
    lastExitCode: typeof input.lastExitCode === "number" ? input.lastExitCode : base.lastExitCode,
    restartCount: typeof input.restartCount === "number" ? input.restartCount : base.restartCount,
    lastError: typeof input.lastError === "string" ? input.lastError : base.lastError,
    lastOutputAt: typeof input.lastOutputAt === "string" ? input.lastOutputAt : base.lastOutputAt,
  };
}

export function mergePersistedCloudflareState(
  base: CloudflareOnboardingState,
  source: unknown,
): CloudflareOnboardingState {
  const input = source && typeof source === "object"
    ? (source as Partial<CloudflareOnboardingState>)
    : {};

  return {
    ...base,
    status:
      input.status === "pending-consent"
      || input.status === "login-required"
      || input.status === "provisioning"
      || input.status === "ready"
      || input.status === "error"
        ? input.status
        : base.status,
    message: typeof input.message === "string" ? input.message : base.message,
    binaryPath: typeof input.binaryPath === "string" ? input.binaryPath : base.binaryPath,
    appDirectory: typeof input.appDirectory === "string" ? input.appDirectory : base.appDirectory,
    tunnelName: typeof input.tunnelName === "string" ? input.tunnelName : base.tunnelName,
    tunnelId: typeof input.tunnelId === "string" ? input.tunnelId : base.tunnelId,
    hostname: typeof input.hostname === "string" ? input.hostname : base.hostname,
    publicUrl: typeof input.publicUrl === "string" ? input.publicUrl : base.publicUrl,
    certPath: typeof input.certPath === "string" ? input.certPath : base.certPath,
    credentialsPath: typeof input.credentialsPath === "string" ? input.credentialsPath : base.credentialsPath,
    configPath: typeof input.configPath === "string" ? input.configPath : base.configPath,
    loginRequired: input.loginRequired === true,
    dnsRouted: input.dnsRouted === true,
    dnsJustProvisioned: false,
    setupStage:
      input.setupStage === "idle"
      || input.setupStage === "creating-tunnel"
      || input.setupStage === "routing-dns"
      || input.setupStage === "launching"
      || input.setupStage === "ready"
      || input.setupStage === "failed"
        ? input.setupStage
        : base.setupStage,
    requiresUserAction:
      input.requiresUserAction === true
        ? true
        : input.requiresUserAction === false
          ? false
          : base.requiresUserAction,
    nextAction:
      input.nextAction === "connect-cloudflare"
      || input.nextAction === "retry-cloudflare"
      || input.nextAction === "skip-cloudflare"
      || input.nextAction === "none"
        ? input.nextAction
        : base.nextAction,
    canRetry:
      input.canRetry === true
        ? true
        : input.canRetry === false
          ? false
          : base.canRetry,
    lastUserPromptAt: typeof input.lastUserPromptAt === "string" ? input.lastUserPromptAt : base.lastUserPromptAt,
    lastAttemptAt: typeof input.lastAttemptAt === "string" ? input.lastAttemptAt : base.lastAttemptAt,
    lastCheckedAt: typeof input.lastCheckedAt === "string" ? input.lastCheckedAt : base.lastCheckedAt,
  };
}

export function setStoppedProcessState(target: RuntimeProcessState, options?: ProcessStoppedOptions) {
  target.running = false;
  target.spawnId = null;
  target.pid = null;

  if (options?.clearCommand) {
    target.command = "";
    target.args = [];
  }

  if (options && "lastError" in options) {
    target.lastError = options.lastError ?? null;
  }
  if (options && "lastExitAt" in options) {
    target.lastExitAt = options.lastExitAt ?? null;
  }
  if (options && "lastExitCode" in options) {
    target.lastExitCode = options.lastExitCode ?? null;
  }
}

export function parseExitCode(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (value && typeof value === "object") {
    const source = value as {
      exitCode?: unknown;
      code?: unknown;
    };
    if (typeof source.exitCode === "number" && Number.isFinite(source.exitCode)) {
      return Math.floor(source.exitCode);
    }
    if (typeof source.code === "number" && Number.isFinite(source.code)) {
      return Math.floor(source.code);
    }
  }
  return null;
}

export function summarizeDetailData(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, 240);
}
