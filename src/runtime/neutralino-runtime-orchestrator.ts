import {
  events,
  filesystem,
  init as nlInit,
  os,
} from "@neutralinojs/lib";
import {
  ensureCloudflareOnboarding,
  type CloudflareOnboardingState,
} from "./cloudflared-onboarding";

export type ManagedProcessName =
  | "mp3Helper"
  | "mediamtx"
  | "ffmpegIngest"
  | "ffmpegMp3Bridge"
  | "cloudflared";

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
  mp3HelperPath: string;
  mp3HelperHost: string;
  mp3HelperPort: number;
  mp3MountPath: string;
  relayRtmpOrigin: string;
  sampleRate: string;
  channels: string;
  cloudflaredPath: string;
  cloudflareMode: CloudflareMode;
  cloudflareTunnelName: string;
  cloudflareHostname: string;
  cloudflareConfigPath: string;
};

export type RuntimeState = {
  schemaVersion: 1;
  startedAt: string;
  lastUpdatedAt: string;
  appDataDirectory: string;
  stateFilePath: string;
  phase: "starting" | "running" | "stopping" | "error";
  lastError: string | null;
  config: RuntimeConfig;
  cloudflare: CloudflareOnboardingState;
  processes: Record<ManagedProcessName, RuntimeProcessState>;
};

type SpawnedProcessEventDetail = {
  id?: unknown;
  action?: unknown;
  data?: unknown;
};

type RuntimeWindow = Window & {
  __nlReady?: boolean;
  __relyyNeutralinoReady?: boolean;
  __relyyRuntimeState?: RuntimeState;
};

type ProcessLaunch = {
  executable: string;
  args: string[];
  envs?: Record<string, string>;
};

type CloudflareOnboardingTrigger = "auto" | "request-login" | "retry";

type StartManagedProcessOptions = {
  cloudflareTrigger?: CloudflareOnboardingTrigger;
};

const APP_DATA_DIRECTORY_NAME = "relyycast";
const RUNTIME_STATE_FILE_NAME = "runtime-state.json";
const DEFAULT_MOUNT_PATH = "/live.mp3";
const DEFAULT_MP3_HELPER_PORT = 8177;
const DEFAULT_RELAY_RTMP_ORIGIN = "rtmp://127.0.0.1:1935";
const PROCESS_STOP_TIMEOUT_MS = 2000;

const PROCESS_START_ORDER: ManagedProcessName[] = [
  "mp3Helper",
  "mediamtx",
  "ffmpegIngest",
  "ffmpegMp3Bridge",
  "cloudflared",
];

const PROCESS_RESTART_BACKOFF_MS: Record<ManagedProcessName, number> = {
  mp3Helper: 2000,
  mediamtx: 3000,
  ffmpegIngest: 2000,
  ffmpegMp3Bridge: 2000,
  cloudflared: 10_000,
};

let neutralinoInitStarted = false;
let neutralinoReadyPromise: Promise<boolean> | null = null;

let runtimeStartPromise: Promise<void> | null = null;
let runtimeState: RuntimeState | null = null;
let runtimeStatePath = "";
let runtimeAppDataDirectory = "";
let runtimeStopping = false;

let listenersBound = false;
const processBySpawnId = new Map<number, ManagedProcessName>();
const restartTimers = new Map<ManagedProcessName, number>();
let persistQueue: Promise<void> = Promise.resolve();
let cachedProcessEnvs: Record<string, string> | null = null;

export const RUNTIME_STATE_EVENT_NAME = "relyycast:runtime-state";

function nowIso() {
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

function cloneRuntimeState(state: RuntimeState): RuntimeState {
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
    mp3HelperPath: "",
    mp3HelperHost: "127.0.0.1",
    mp3HelperPort: DEFAULT_MP3_HELPER_PORT,
    mp3MountPath: DEFAULT_MOUNT_PATH,
    relayRtmpOrigin: DEFAULT_RELAY_RTMP_ORIGIN,
    sampleRate: "44100",
    channels: "2",
    cloudflaredPath: "",
    cloudflareMode: "named",
    cloudflareTunnelName: "",
    cloudflareHostname: "",
    cloudflareConfigPath: "",
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

function createRuntimeStateTemplate(appDataDirectory: string, stateFilePath: string): RuntimeState {
  return {
    schemaVersion: 1,
    startedAt: nowIso(),
    lastUpdatedAt: nowIso(),
    appDataDirectory,
    stateFilePath,
    phase: "starting",
    lastError: null,
    config: createDefaultConfig(),
    cloudflare: createDefaultCloudflareState(),
    processes: {
      mp3Helper: createProcessState(),
      mediamtx: createProcessState(),
      ffmpegIngest: createProcessState(),
      ffmpegMp3Bridge: createProcessState(),
      cloudflared: createProcessState(),
    },
  };
}

function hasNeutralinoGlobals() {
  if (typeof window === "undefined") {
    return false;
  }

  const w = window as Window & {
    NL_PORT?: unknown;
    NL_TOKEN?: unknown;
  };

  const hasPort = typeof w.NL_PORT === "number" || typeof w.NL_PORT === "string";
  const hasToken = typeof w.NL_TOKEN === "string" && w.NL_TOKEN.length > 0;
  return hasPort && hasToken;
}

function normalizeExecutablePath(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/^"(.*)"$/, "$1");
}

function sanitizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/[\r\n]/g, " ").slice(0, maxLength).trim();
}

function normalizeRelayPath(value: unknown) {
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

function normalizeMountPath(value: unknown) {
  if (typeof value !== "string") {
    return DEFAULT_MOUNT_PATH;
  }

  const mount = value.trim();
  if (!mount || mount === "/") {
    return DEFAULT_MOUNT_PATH;
  }
  if (!mount.startsWith("/") || mount.includes("..") || mount.includes("?")) {
    return DEFAULT_MOUNT_PATH;
  }
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/.test(mount)) {
    return DEFAULT_MOUNT_PATH;
  }
  return mount;
}

function normalizePort(value: unknown, fallback: number) {
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

function normalizeRuntimeConfig(source: unknown): RuntimeConfig {
  const input = source && typeof source === "object" ? (source as Partial<RuntimeConfig>) : {};
  const base = createDefaultConfig();
  const cloudflareHostname = sanitizeText(input.cloudflareHostname, 220) || base.cloudflareHostname;

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
    mp3HelperPath: normalizeExecutablePath(input.mp3HelperPath),
    mp3HelperHost: sanitizeText(input.mp3HelperHost, 120) || base.mp3HelperHost,
    mp3HelperPort: normalizePort(input.mp3HelperPort, base.mp3HelperPort),
    mp3MountPath: normalizeMountPath(input.mp3MountPath),
    relayRtmpOrigin: sanitizeText(input.relayRtmpOrigin, 240) || base.relayRtmpOrigin,
    sampleRate: sanitizeText(input.sampleRate, 12) || base.sampleRate,
    channels: sanitizeText(input.channels, 4) || base.channels,
    cloudflaredPath: normalizeExecutablePath(input.cloudflaredPath),
    cloudflareMode: normalizeCloudflareMode(input.cloudflareMode),
    cloudflareTunnelName: sanitizeText(input.cloudflareTunnelName, 120) || base.cloudflareTunnelName,
    cloudflareHostname,
    cloudflareConfigPath: normalizeExecutablePath(input.cloudflareConfigPath),
  };
}

function mergePersistedProcessState(
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

function mergePersistedCloudflareState(
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

function trimTrailingSeparators(pathname: string) {
  return pathname.replace(/[\\/]+$/g, "");
}

function joinPath(base: string, ...parts: string[]) {
  let joined = trimTrailingSeparators(base);
  for (const part of parts) {
    const normalizedPart = part.replace(/^[\\/]+|[\\/]+$/g, "");
    if (!normalizedPart) {
      continue;
    }
    joined = `${joined}/${normalizedPart}`;
  }
  return joined;
}

function dedupeStrings(values: Array<string | undefined | null>) {
  const output: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    const normalized = value.trim();
    if (!normalized || output.includes(normalized)) {
      continue;
    }
    output.push(normalized);
  }
  return output;
}

function deriveRuntimeRoots() {
  if (typeof window === "undefined") {
    return [];
  }

  const nlPath = (window.NL_PATH ?? "").trim();
  const nlCwd = (window.NL_CWD ?? "").trim();
  const roots = dedupeStrings([nlPath, nlCwd]);

  for (const root of [...roots]) {
    const normalized = root.replace(/\\/g, "/").toLowerCase();
    if (!normalized.endsWith("/build")) {
      continue;
    }
    const parent = root.replace(/[\\/]build$/i, "");
    if (parent && !roots.includes(parent)) {
      roots.push(parent);
    }
  }

  return roots;
}

async function pathExists(pathname: string) {
  try {
    await filesystem.getStats(pathname);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value: string) {
  if (!value) {
    return "\"\"";
  }
  if (!/[\s"]/g.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\\\"")}"`;
}

function buildCommand(executable: string, args: string[]) {
  return [shellQuote(executable), ...args.map((arg) => shellQuote(arg))].join(" ");
}

function normalizeExecutableForSpawn(executable: string) {
  let normalized = executable.trim();
  if (!normalized) {
    return normalized;
  }

  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  if (normalized.startsWith(".\\")) {
    normalized = normalized.slice(2);
  }

  if (isWindows()) {
    normalized = normalized.replace(/\//g, "\\");
  }

  return normalized;
}

function updateRuntimeState(mutator: (current: RuntimeState) => void) {
  if (!runtimeState) {
    return;
  }
  mutator(runtimeState);
  runtimeState.lastUpdatedAt = nowIso();
  publishRuntimeState();
  schedulePersistRuntimeState();
}

function mutateRuntimeStateInMemory(mutator: (current: RuntimeState) => void) {
  if (!runtimeState) {
    return;
  }
  mutator(runtimeState);
  runtimeState.lastUpdatedAt = nowIso();
  publishRuntimeState();
}

function publishRuntimeState() {
  if (!runtimeState || typeof window === "undefined") {
    return;
  }
  const runtimeWindow = window as RuntimeWindow;
  const snapshot = cloneRuntimeState(runtimeState);
  runtimeWindow.__relyyRuntimeState = snapshot;
  window.dispatchEvent(
    new CustomEvent(RUNTIME_STATE_EVENT_NAME, {
      detail: snapshot,
    }),
  );
}

async function getMergedProcessEnvs(overrides?: Record<string, string>) {
  if (!overrides) {
    return undefined;
  }

  if (!cachedProcessEnvs) {
    cachedProcessEnvs = await os.getEnvs().catch(() => ({} as Record<string, string>));
  }

  return {
    ...cachedProcessEnvs,
    ...overrides,
  };
}

function schedulePersistRuntimeState() {
  if (!runtimeStatePath || !runtimeState) {
    return;
  }
  const payload = `${JSON.stringify(runtimeState, null, 2)}\n`;
  persistQueue = persistQueue
    .then(() => filesystem.writeFile(runtimeStatePath, payload))
    .catch((error: unknown) => {
      console.error("[runtime] failed to persist runtime state:", error);
    });
}

async function ensureNeutralinoReady() {
  if (typeof window === "undefined" || !hasNeutralinoGlobals()) {
    return false;
  }

  const runtimeWindow = window as RuntimeWindow;
  if (runtimeWindow.__relyyNeutralinoReady || runtimeWindow.__nlReady) {
    runtimeWindow.__relyyNeutralinoReady = true;
    return true;
  }

  if (neutralinoReadyPromise) {
    return neutralinoReadyPromise;
  }

  neutralinoReadyPromise = new Promise<boolean>((resolve) => {
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
      if (!neutralinoInitStarted) {
        neutralinoInitStarted = true;
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

  return neutralinoReadyPromise;
}

async function resolveRuntimeStatePath() {
  const dataRoot = await os.getPath("data");
  runtimeAppDataDirectory = joinPath(dataRoot, APP_DATA_DIRECTORY_NAME);
  runtimeStatePath = joinPath(runtimeAppDataDirectory, RUNTIME_STATE_FILE_NAME);

  try {
    await filesystem.createDirectory(runtimeAppDataDirectory);
  } catch {
    // Directory already exists.
  }
}

async function loadRuntimeState() {
  const base = createRuntimeStateTemplate(runtimeAppDataDirectory, runtimeStatePath);

  try {
    const raw = await filesystem.readFile(runtimeStatePath);
    const parsed = JSON.parse(raw) as Partial<RuntimeState>;

    base.config = normalizeRuntimeConfig(parsed.config);
    base.cloudflare = mergePersistedCloudflareState(base.cloudflare, parsed.cloudflare);
    base.phase = "starting";
    base.lastError = typeof parsed.lastError === "string" ? parsed.lastError : null;
    base.processes.mp3Helper = mergePersistedProcessState(base.processes.mp3Helper, parsed.processes?.mp3Helper);
    base.processes.mediamtx = mergePersistedProcessState(base.processes.mediamtx, parsed.processes?.mediamtx);
    base.processes.ffmpegIngest = mergePersistedProcessState(base.processes.ffmpegIngest, parsed.processes?.ffmpegIngest);
    base.processes.ffmpegMp3Bridge = mergePersistedProcessState(
      base.processes.ffmpegMp3Bridge,
      parsed.processes?.ffmpegMp3Bridge,
    );
    base.processes.cloudflared = mergePersistedProcessState(
      base.processes.cloudflared,
      parsed.processes?.cloudflared,
    );
  } catch {
    // Use defaults if no previous state is found.
  }

  return base;
}

function parseExitCode(value: unknown) {
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

function summarizeDetailData(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, 240);
}

function clearRestartTimer(name: ManagedProcessName) {
  const timer = restartTimers.get(name);
  if (!timer) {
    return;
  }
  window.clearTimeout(timer);
  restartTimers.delete(name);
}

function shouldRestartManagedProcess(name: ManagedProcessName) {
  if (runtimeStopping || !runtimeState) {
    return false;
  }
  if (!isManagedProcessEnabled(name, runtimeState.config)) {
    return false;
  }
  if (name !== "cloudflared") {
    return true;
  }
  return runtimeState.cloudflare.status === "ready";
}

function isManagedProcessEnabled(name: ManagedProcessName, config: RuntimeConfig) {
  if (name === "mp3Helper" || name === "ffmpegMp3Bridge") {
    return config.mp3Enabled === true;
  }
  return true;
}

function scheduleRestart(name: ManagedProcessName, reason: string) {
  if (!shouldRestartManagedProcess(name) || restartTimers.has(name)) {
    return;
  }

  const backoff = PROCESS_RESTART_BACKOFF_MS[name];
  updateRuntimeState((current) => {
    current.processes[name].restartCount += 1;
    current.processes[name].lastError = reason;
  });

  const timer = window.setTimeout(() => {
    restartTimers.delete(name);
    void startManagedProcess(name);
  }, backoff);

  restartTimers.set(name, timer);
}

async function terminateSpawnedProcess(id: number) {
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

function getPlatformName() {
  const source = String(window.NL_OS ?? "").toLowerCase();
  if (source.includes("windows")) {
    return "windows";
  }
  if (source.includes("darwin") || source.includes("mac")) {
    return "darwin";
  }
  return "linux";
}

function getArchName() {
  const source = String(window.NL_ARCH ?? "").toLowerCase();
  if (source.includes("arm64") || source === "arm") {
    return "arm64";
  }
  return "x64";
}

function isWindows() {
  return getPlatformName() === "windows";
}

async function resolveBunExecutable() {
  const envs = cachedProcessEnvs ?? await os.getEnvs().catch(() => ({} as Record<string, string>));
  const candidates: string[] = [];
  const configured = typeof envs.BUN_BIN === "string" ? envs.BUN_BIN.trim() : "";
  if (configured) {
    candidates.push(configured);
  }

  if (isWindows()) {
    const userProfile = typeof envs.USERPROFILE === "string" ? envs.USERPROFILE.trim() : "";
    if (userProfile) {
      candidates.push(joinPath(userProfile, ".bun", "bin", "bun.exe"));
      candidates.push(
        joinPath(
          userProfile,
          "AppData",
          "Local",
          "Microsoft",
          "WinGet",
          "Packages",
          "Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe",
          "bun-windows-x64",
          "bun.exe",
        ),
      );
    }
    // On Windows fall through to the raw "bun" PATH name if none of the
    // above candidate paths resolve — the installer puts it on PATH.
    const detected = await findFirstExisting(candidates);
    return detected ?? "bun";
  }

  // macOS / Linux: add the standard bun install locations so we can
  // definitively tell whether bun is present.  If it is NOT found at
  // any known path, return null rather than the bare "bun" string.
  // Returning the bare string causes os.spawnProcess to launch a shell
  // that exits immediately with code 127, which briefly flips
  // mp3Helper.running to true and triggers failed health-check fetches.
  // Users who install bun to a non-standard location can set BUN_BIN.
  const home = typeof envs.HOME === "string" ? envs.HOME.trim() : "";
  if (home) {
    candidates.push(joinPath(home, ".bun", "bin", "bun"));
  }
  candidates.push("/opt/homebrew/bin/bun");
  candidates.push("/usr/local/bin/bun");

  return await findFirstExisting(candidates);
}

async function findFirstExisting(paths: string[]) {
  for (const candidate of paths) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function resolveMediatxPath(config: RuntimeConfig) {
  const explicitPath = normalizeExecutablePath(config.mediamtxPath);
  if (explicitPath) {
    return explicitPath;
  }

  const roots = deriveRuntimeRoots();
  const platform = getPlatformName();
  const candidates = isWindows()
    ? roots.flatMap((root) => [
      joinPath(root, "build", "mediamtx", "win", "mediamtx.exe"),
      joinPath(root, "mediamtx", "win", "mediamtx.exe"),
    ])
    : roots.flatMap((root) => [
      joinPath(root, "build", "mediamtx", platform === "darwin" ? "mac" : "linux", "mediamtx"),
      joinPath(root, "mediamtx", platform === "darwin" ? "mac" : "linux", "mediamtx"),
      joinPath(root, "build", "bin", "mediamtx"),
      joinPath(root, "bin", "mediamtx"),
    ]);

  const detected = await findFirstExisting(candidates);
  if (detected) {
    return detected;
  }

  return isWindows() ? "mediamtx.exe" : "mediamtx";
}

async function resolveMediatxConfigPath(config: RuntimeConfig) {
  const explicitPath = normalizeExecutablePath(config.mediamtxConfigPath);
  if (explicitPath) {
    return explicitPath;
  }

  const roots = deriveRuntimeRoots();
  const candidates = roots.flatMap((root) => [
    joinPath(root, "build", "mediamtx", "mediamtx.yml"),
    joinPath(root, "mediamtx", "mediamtx.yml"),
    joinPath(root, "server", "mediamtx.yml"),
  ]);

  const detected = await findFirstExisting(candidates);
  return detected ?? "";
}

async function resolveFfmpegPath(config: RuntimeConfig) {
  const explicitPath = normalizeExecutablePath(config.ffmpegPath);
  if (explicitPath) {
    return explicitPath;
  }

  const roots = deriveRuntimeRoots();
  const candidates = isWindows()
    ? [
      ...roots.map((root) => joinPath(root, "bin", "ffmpeg.exe")),
      "C:/ffmpeg/bin/ffmpeg.exe",
      "C:/ffmpeg/ffmpeg.exe",
      "C:/ProgramData/chocolatey/bin/ffmpeg.exe",
    ]
    : [
      ...roots.map((root) => joinPath(root, "bin", "ffmpeg")),
      "/usr/local/bin/ffmpeg",
      "/opt/homebrew/bin/ffmpeg",
      "/usr/bin/ffmpeg",
    ];

  const detected = await findFirstExisting(candidates);
  if (detected) {
    return detected;
  }

  return isWindows() ? "ffmpeg.exe" : "ffmpeg";
}

async function resolveMp3HelperLaunch(config: RuntimeConfig): Promise<ProcessLaunch | null> {
  const helperArgs = [
    "--host",
    config.mp3HelperHost,
    "--port",
    String(config.mp3HelperPort),
    "--mount",
    config.mp3MountPath,
    "--station-name",
    config.stationName,
    "--station-genre",
    config.genre,
    "--station-description",
    config.description,
  ];
  const explicitPath = normalizeExecutablePath(config.mp3HelperPath);
  if (explicitPath) {
    return {
      executable: explicitPath,
      args: helperArgs,
    };
  }

  const roots = deriveRuntimeRoots();
  const platform = getPlatformName();
  const arch = getArchName();
  const helperBinaryName = isWindows() ? "relyy-mp3-helper.exe" : "relyy-mp3-helper";
  const platformTarget =
    platform === "windows"
      ? `bun-windows-${arch}-modern`
      : platform === "darwin"
        ? `bun-darwin-${arch}`
        : `bun-linux-${arch}-modern`;

  const binaryCandidates = roots.flatMap((root) => [
    joinPath(root, "build", "bin", helperBinaryName),
    joinPath(root, "runtime", "bun-mp3-helper", "dist", "host", helperBinaryName),
    joinPath(root, "runtime", "bun-mp3-helper", "dist", platformTarget, helperBinaryName),
    joinPath(root, "runtime", "bun-mp3-helper", "dist", `${platform}-${arch}`, helperBinaryName),
  ]);

  const detectedBinary = await findFirstExisting(binaryCandidates);
  const scriptCandidates = roots.map((root) => joinPath(root, "runtime", "bun-mp3-helper", "src", "main.ts"));
  const detectedScript = await findFirstExisting(scriptCandidates);
  if (detectedScript) {
    const bunExecutable = await resolveBunExecutable();
    if (bunExecutable) {
      return {
        executable: bunExecutable,
        args: ["run", detectedScript, ...helperArgs],
      };
    }
  }

  if (detectedBinary) {
    return {
      executable: detectedBinary,
      args: helperArgs,
    };
  }

  // Binary and bun not found — return null so the orchestrator leaves
  // mp3Helper stopped without scheduling a restart loop that re-renders
  // every 2s and breaks input focus on Mac.
  return null;
}

function getRelayEndpoints(config: RuntimeConfig) {
  const relayPath = normalizeRelayPath(config.relayPath);
  const rtmpBase = (config.relayRtmpOrigin || DEFAULT_RELAY_RTMP_ORIGIN).replace(/\/+$/g, "");
  return {
    relayPath,
    rtmpPublishUrl: `${rtmpBase}/${relayPath}`,
    rtmpReadUrl: `${rtmpBase}/${relayPath}`,
  };
}

function getCloudflareOriginUrl(config: RuntimeConfig) {
  if (!config.mp3Enabled) {
    return "http://127.0.0.1:8888";
  }
  const host = sanitizeText(config.mp3HelperHost, 120) || "127.0.0.1";
  const port = normalizePort(config.mp3HelperPort, DEFAULT_MP3_HELPER_PORT);
  return `http://${host}:${port}`;
}

function getFfmpegReconnectArgs(inputUrl: string) {
  const source = inputUrl.trim().toLowerCase();
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "2"];
  }
  return [];
}

function buildIngestFfmpegArgs(config: RuntimeConfig, rtmpPublishUrl: string) {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    ...getFfmpegReconnectArgs(config.inputUrl),
    "-i",
    config.inputUrl,
    "-vn",
    "-ac",
    config.channels,
    "-ar",
    config.sampleRate,
    "-c:a",
    "aac",
    "-b:a",
    config.bitrate,
    "-f",
    "flv",
    rtmpPublishUrl,
  ];
}

function buildMp3BridgeFfmpegArgs(config: RuntimeConfig, rtmpReadUrl: string) {
  const sourceUrl = `http://${config.mp3HelperHost}:${config.mp3HelperPort}${config.mp3MountPath}`;
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-i",
    rtmpReadUrl,
    "-vn",
    "-ac",
    config.channels,
    "-ar",
    config.sampleRate,
    "-c:a",
    "libmp3lame",
    "-b:a",
    config.bitrate,
    "-f",
    "mp3",
    "-content_type",
    "audio/mpeg",
    "-method",
    "PUT",
    sourceUrl,
  ];
}

async function buildLaunchForProcess(
  name: ManagedProcessName,
  config: RuntimeConfig,
  options?: StartManagedProcessOptions,
): Promise<ProcessLaunch | null> {
  if (name === "mp3Helper") {
    return resolveMp3HelperLaunch(config);
  }

  if (name === "cloudflared") {
    const trigger = options?.cloudflareTrigger ?? "auto";
    const onboarding = await ensureCloudflareOnboarding({
      appDataDirectory: runtimeAppDataDirectory,
      runtimeRoots: deriveRuntimeRoots(),
      cloudflaredPath: config.cloudflaredPath,
      cloudflareMode: config.cloudflareMode,
      cloudflareTunnelName: config.cloudflareTunnelName,
      cloudflareHostname: config.cloudflareHostname,
      cloudflareConfigPath: config.cloudflareConfigPath,
      originUrl: getCloudflareOriginUrl(config),
      hlsOriginUrl: "http://127.0.0.1:8888",
      hlsRelayPath: normalizeRelayPath(config.relayPath),
      trigger,
      previousState: runtimeState?.cloudflare ?? null,
    });

    updateRuntimeState((current) => {
      current.cloudflare = onboarding.state;
    });

    if (!onboarding.launch) {
      return null;
    }

    return {
      executable: onboarding.launch.executable,
      args: onboarding.launch.args,
    };
  }

  if (name === "mediamtx") {
    const executable = await resolveMediatxPath(config);
    const configPath = await resolveMediatxConfigPath(config);
    return {
      executable,
      args: configPath ? [configPath] : [],
    };
  }

  const ffmpegPath = await resolveFfmpegPath(config);
  const relayEndpoints = getRelayEndpoints(config);

  if (name === "ffmpegIngest") {
    return {
      executable: ffmpegPath,
      args: buildIngestFfmpegArgs(config, relayEndpoints.rtmpPublishUrl),
    };
  }

  return {
    executable: ffmpegPath,
    args: buildMp3BridgeFfmpegArgs(config, relayEndpoints.rtmpReadUrl),
  };
}

function getProcessCwd() {
  const roots = deriveRuntimeRoots();
  if (!roots.length) {
    return undefined;
  }
  const preferredRoot = roots.find((root) => !root.replace(/\\/g, "/").toLowerCase().endsWith("/build"));
  return preferredRoot ?? roots[0];
}

const QUICK_TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function extractQuickTunnelUrl(value: string) {
  const match = value.match(QUICK_TUNNEL_URL_PATTERN);
  return match ? match[0] : null;
}

function getHostnameFromUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

async function startManagedProcess(name: ManagedProcessName, options?: StartManagedProcessOptions) {
  if (runtimeStopping || !runtimeState) {
    return;
  }

  if (!isManagedProcessEnabled(name, runtimeState.config)) {
    clearRestartTimer(name);
    updateRuntimeState((current) => {
      const target = current.processes[name];
      target.running = false;
      target.spawnId = null;
      target.pid = null;
      target.command = "";
      target.args = [];
      target.lastError = null;
    });
    return;
  }

  const state = runtimeState.processes[name];
  if (state.running) {
    return;
  }

  clearRestartTimer(name);

  try {
    const launch = await buildLaunchForProcess(name, runtimeState.config, options);
    if (!launch) {
      updateRuntimeState((current) => {
        const target = current.processes[name];
        target.running = false;
        target.spawnId = null;
        target.pid = null;
        target.command = "";
        target.args = [];
        if (name === "cloudflared") {
          target.lastError = current.cloudflare.message;
        }
      });
      return;
    }

    const normalizedExecutable = normalizeExecutableForSpawn(launch.executable);
    const command = buildCommand(normalizedExecutable, launch.args);
    const envs = await getMergedProcessEnvs(launch.envs);
    const spawned = await os.spawnProcess(command, {
      cwd: getProcessCwd(),
      ...(envs ? { envs } : {}),
    });

    processBySpawnId.set(spawned.id, name);
    updateRuntimeState((current) => {
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
    updateRuntimeState((current) => {
      const target = current.processes[name];
      target.running = false;
      target.lastError = message;
      target.lastExitAt = nowIso();
      target.lastExitCode = null;
    });
    if (shouldRestartManagedProcess(name)) {
      scheduleRestart(name, message);
    }
  }
}

async function startAllManagedProcesses() {
  for (const name of PROCESS_START_ORDER) {
    await startManagedProcess(name);
    await new Promise((resolve) => window.setTimeout(resolve, 300));
  }
}

async function stopManagedProcess(name: ManagedProcessName) {
  if (!runtimeState) {
    return;
  }

  clearRestartTimer(name);
  const current = runtimeState.processes[name];
  const spawnId = current.spawnId;
  if (typeof spawnId === "number") {
    await terminateSpawnedProcess(spawnId);
    processBySpawnId.delete(spawnId);
  }

  updateRuntimeState((next) => {
    const target = next.processes[name];
    target.running = false;
    target.spawnId = null;
    target.pid = null;
    target.lastExitAt = nowIso();
  });
}

async function cleanupStaleProcesses() {
  const spawned = await os.getSpawnedProcesses().catch(() => []);
  if (!Array.isArray(spawned) || !spawned.length) {
    return;
  }

  for (const process of spawned) {
    if (!process || typeof process.id !== "number") {
      continue;
    }
    await terminateSpawnedProcess(process.id);
  }
}

async function killOrphanedManagedProcesses() {
  // Windows behavior is working correctly; leave it untouched.
  if (isWindows()) {
    return;
  }

  // Kill any app-managed processes left over from a previous session that was
  // hard-closed or crashed (those won't appear in getSpawnedProcesses).
  // These are binaries unique to this app, so killing by exact name is safe.
  const names = ["mediamtx", "relyy-mp3-helper", "cloudflared"];
  for (const name of names) {
    try {
      await os.execCommand(`pkill -f "${name}" 2>/dev/null || true`);
    } catch {
      // Ignore — no matching process is not an error.
    }
  }
}

function handleSpawnedProcessEvent(event: CustomEvent<SpawnedProcessEventDetail>) {
  const detail = event.detail;
  const id = typeof detail?.id === "number" ? detail.id : null;
  if (id === null || !runtimeState) {
    return;
  }

  const processName = processBySpawnId.get(id);
  if (!processName) {
    return;
  }

  const action = typeof detail.action === "string" ? detail.action : "";
  if (action === "stdOut") {
    const stdOutMessage = summarizeDetailData(detail.data);
    mutateRuntimeStateInMemory((current) => {
      current.processes[processName].lastOutputAt = nowIso();
      if (processName === "cloudflared") {
        const quickTunnelUrl = extractQuickTunnelUrl(stdOutMessage);
        if (quickTunnelUrl) {
          current.cloudflare.publicUrl = quickTunnelUrl;
          current.cloudflare.hostname = getHostnameFromUrl(quickTunnelUrl);
          current.cloudflare.status = "ready";
          current.cloudflare.message = "Temporary Cloudflare URL active. No Cloudflare domain is required.";
          current.cloudflare.requiresUserAction = false;
          current.cloudflare.nextAction = "none";
          current.cloudflare.canRetry = false;
        }
      }
    });
    return;
  }

  if (action === "stdErr") {
    const stderrMessage = summarizeDetailData(detail.data);
    mutateRuntimeStateInMemory((current) => {
      const target = current.processes[processName];
      target.lastOutputAt = nowIso();
      if (stderrMessage) {
        target.lastError = stderrMessage;
      }
      if (processName === "cloudflared") {
        const quickTunnelUrl = extractQuickTunnelUrl(stderrMessage);
        if (quickTunnelUrl) {
          current.cloudflare.publicUrl = quickTunnelUrl;
          current.cloudflare.hostname = getHostnameFromUrl(quickTunnelUrl);
          current.cloudflare.status = "ready";
          current.cloudflare.message = "Temporary Cloudflare URL active. No Cloudflare domain is required.";
          current.cloudflare.requiresUserAction = false;
          current.cloudflare.nextAction = "none";
          current.cloudflare.canRetry = false;
        }
      }
    });
    return;
  }

  if (action !== "exit") {
    return;
  }

  processBySpawnId.delete(id);
  const exitCode = parseExitCode(detail.data);
  updateRuntimeState((current) => {
    const target = current.processes[processName];
    target.running = false;
    target.spawnId = null;
    target.pid = null;
    target.lastExitAt = nowIso();
    target.lastExitCode = exitCode;
  });

  if (!runtimeStopping) {
    const reason = exitCode === null ? "process exited unexpectedly" : `process exited with code ${exitCode}`;
    scheduleRestart(processName, reason);
  }
}

function bindRuntimeListeners() {
  if (listenersBound) {
    return;
  }
  listenersBound = true;

  void events.on(
    "spawnedProcess",
    handleSpawnedProcessEvent as unknown as (event: CustomEvent) => void,
  );
  void events.on("windowClose", () => {
    void stopRuntimeOrchestration("windowClose");
  });

  window.addEventListener("beforeunload", () => {
    void stopRuntimeOrchestration("beforeunload");
  });
}

export async function stopRuntimeOrchestration(reason: string) {
  if (!runtimeState || runtimeStopping) {
    return;
  }

  runtimeStopping = true;
  updateRuntimeState((current) => {
    current.phase = "stopping";
    current.lastError = reason;
  });

  for (const name of PROCESS_START_ORDER) {
    await stopManagedProcess(name);
  }

  updateRuntimeState((current) => {
    current.phase = "stopping";
  });
}

async function startRuntimeOrchestrationInternal() {
  const ready = await ensureNeutralinoReady();
  if (!ready) {
    return;
  }

  runtimeStopping = false;
  bindRuntimeListeners();

  await resolveRuntimeStatePath();
  runtimeState = await loadRuntimeState();
  publishRuntimeState();
  schedulePersistRuntimeState();

  await cleanupStaleProcesses();
  await killOrphanedManagedProcesses();
  await startAllManagedProcesses();

  updateRuntimeState((current) => {
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
    if (runtimeState) {
      updateRuntimeState((current) => {
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
  if (!runtimeState || runtimeStopping) {
    return;
  }

  runtimeStopping = true;
  updateRuntimeState((current) => {
    current.phase = "starting";
  });

  try {
    for (const name of PROCESS_START_ORDER) {
      await stopManagedProcess(name);
    }
  } finally {
    runtimeStopping = false;
  }

  await startAllManagedProcesses();
  updateRuntimeState((current) => {
    current.phase = "running";
    current.lastError = null;
  });
}

async function runCloudflareSetupAction(trigger: CloudflareOnboardingTrigger) {
  if (!runtimeState) {
    throw new Error("runtime state is not initialized");
  }
  if (runtimeStopping) {
    throw new Error("runtime is stopping");
  }

  const startedAt = nowIso();
  updateRuntimeState((current) => {
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

  clearRestartTimer("cloudflared");
  if (runtimeState.processes.cloudflared.running) {
    await stopManagedProcess("cloudflared");
  }

  await startManagedProcess("cloudflared", { cloudflareTrigger: trigger });
  return getRuntimeStateSnapshot();
}

export async function requestCloudflareLogin() {
  return runCloudflareSetupAction("request-login");
}

export async function retryCloudflareSetup() {
  return runCloudflareSetupAction("retry");
}

export async function skipCloudflareForNow() {
  if (!runtimeState) {
    throw new Error("runtime state is not initialized");
  }
  if (runtimeStopping) {
    throw new Error("runtime is stopping");
  }

  clearRestartTimer("cloudflared");
  if (runtimeState.processes.cloudflared.running) {
    await stopManagedProcess("cloudflared");
  }

  const skippedAt = nowIso();
  updateRuntimeState((current) => {
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

    const target = current.processes.cloudflared;
    target.running = false;
    target.spawnId = null;
    target.pid = null;
    target.command = "";
    target.args = [];
    target.lastError = current.cloudflare.message;
  });

  return getRuntimeStateSnapshot();
}

export function getRuntimeStateSnapshot() {
  if (!runtimeState) {
    return null;
  }
  return cloneRuntimeState(runtimeState);
}

export async function getPersistedRuntimeStateSnapshot() {
  const ready = await ensureNeutralinoReady();
  if (!ready) {
    return getRuntimeStateSnapshot();
  }

  if (!runtimeStatePath) {
    await resolveRuntimeStatePath();
  }

  try {
    const raw = await filesystem.readFile(runtimeStatePath);
    return JSON.parse(raw) as RuntimeState;
  } catch {
    return getRuntimeStateSnapshot();
  }
}

export async function updateRuntimeConfig(input: Partial<RuntimeConfig>) {
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

  updateRuntimeState((current) => {
    current.config = nextConfig;
  });

  if (runtimeState.phase === "running") {
    await restartManagedProcessesForConfigUpdate();
  }

  return getRuntimeStateSnapshot();
}
