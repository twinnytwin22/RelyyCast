import type {
  CloudflareMode,
  RuntimeConfig,
} from "@/src/runtime/neutralino-runtime-orchestrator";

export const SETTINGS_STORAGE_KEY = "relyycast:server-config";
export const CLOUDFLARE_ACTION_PENDING_TIMEOUT_MS = 1500;
export const RUNTIME_STATE_POLL_MS = 2000;

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  mp3Enabled: false,
  inputUrl: "http://127.0.0.1:4850/live.mp3",
  stationName: "",
  genre: "Various",
  description: "Local FFmpeg test source",
  bitrate: "128k",
  ffmpegPath: "",
  relayPath: "live",
  mediamtxPath: "",
  mediamtxConfigPath: "",
  cloudflareMode: "named",
  cloudflareHostname: "",
  cloudflareTunnelName: "relyycast-local",
  updatesAutoEnabled: true,
};

function normalizeCloudflareMode(value: unknown): CloudflareMode {
  if (value === "temporary" || value === "named") {
    return value;
  }
  return "named";
}

export function normalizeServerConfig(input: unknown): ServerConfig {
  const src = input && typeof input === "object" ? (input as Partial<ServerConfig>) : {};
  return {
    mp3Enabled: src.mp3Enabled === true,
    inputUrl: typeof src.inputUrl === "string" ? src.inputUrl : DEFAULT_SERVER_CONFIG.inputUrl,
    stationName: typeof src.stationName === "string" ? src.stationName : DEFAULT_SERVER_CONFIG.stationName,
    genre: typeof src.genre === "string" ? src.genre : DEFAULT_SERVER_CONFIG.genre,
    description: typeof src.description === "string" ? src.description : DEFAULT_SERVER_CONFIG.description,
    bitrate: typeof src.bitrate === "string" ? src.bitrate : DEFAULT_SERVER_CONFIG.bitrate,
    ffmpegPath: typeof src.ffmpegPath === "string" ? src.ffmpegPath : DEFAULT_SERVER_CONFIG.ffmpegPath,
    relayPath: typeof src.relayPath === "string" ? src.relayPath : DEFAULT_SERVER_CONFIG.relayPath,
    mediamtxPath: typeof src.mediamtxPath === "string" ? src.mediamtxPath : DEFAULT_SERVER_CONFIG.mediamtxPath,
    mediamtxConfigPath:
      typeof src.mediamtxConfigPath === "string"
        ? src.mediamtxConfigPath
        : DEFAULT_SERVER_CONFIG.mediamtxConfigPath,
    cloudflareMode: normalizeCloudflareMode(src.cloudflareMode),
    cloudflareHostname:
      typeof src.cloudflareHostname === "string"
        ? src.cloudflareHostname
        : DEFAULT_SERVER_CONFIG.cloudflareHostname,
    cloudflareTunnelName:
      typeof src.cloudflareTunnelName === "string"
        ? src.cloudflareTunnelName
        : DEFAULT_SERVER_CONFIG.cloudflareTunnelName,
    updatesAutoEnabled:
      typeof src.updatesAutoEnabled === "boolean"
        ? src.updatesAutoEnabled
        : DEFAULT_SERVER_CONFIG.updatesAutoEnabled,
  };
}

export function mapRuntimeConfigToServerConfig(config: RuntimeConfig): ServerConfig {
  return normalizeServerConfig(config);
}

export function mapServerConfigToRuntimeConfig(config: ServerConfig): Partial<RuntimeConfig> {
  const normalized = normalizeServerConfig(config);
  return {
    mp3Enabled: normalized.mp3Enabled,
    inputUrl: normalized.inputUrl,
    stationName: normalized.stationName,
    genre: normalized.genre,
    description: normalized.description,
    bitrate: normalized.bitrate,
    ffmpegPath: normalized.ffmpegPath,
    relayPath: normalized.relayPath,
    mediamtxPath: normalized.mediamtxPath,
    mediamtxConfigPath: normalized.mediamtxConfigPath,
    cloudflareMode: normalized.cloudflareMode,
    cloudflareHostname: normalized.cloudflareHostname,
    cloudflareTunnelName: normalized.cloudflareTunnelName,
    updatesAutoEnabled: normalized.updatesAutoEnabled,
  };
}

export function readStoredConfig(): ServerConfig | null {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    return normalizeServerConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeStoredConfig(config: ServerConfig): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage write errors in restricted contexts.
  }
}
