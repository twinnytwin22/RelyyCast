import { useEffect, useMemo, useRef, useState } from "react";
import { os as nlOs } from "@neutralinojs/lib";
import AppStatusFooter from "@/components/chrome/AppStatusFooter";
import AppWindowChrome from "@/components/chrome/AppWindowChrome";
import {
  type CloudflareMode,
  getPersistedRuntimeStateSnapshot,
  getRuntimeStateSnapshot,
  RUNTIME_STATE_EVENT_NAME,
  requestCloudflareLogin,
  retryCloudflareSetup,
  skipCloudflareForNow,
  updateRuntimeConfig,
  type RuntimeConfig,
  type RuntimeProcessState,
  type RuntimeState,
} from "@/src/runtime/neutralino-runtime-orchestrator";
type TabId = "control" | "settings";

type ServerConfig = {
  mp3Enabled: boolean;
  inputUrl: string;
  stationName: string;
  genre: string;
  description: string;
  bitrate: string;
  ffmpegPath: string;
  relayPath: string;
  mediamtxPath: string;
  mediamtxConfigPath: string;
  cloudflareMode: CloudflareMode;
  cloudflareHostname: string;
  cloudflareTunnelName: string;
};

type ProcessRuntime = {
  running: boolean;
  lastError: string | null;
};

type StreamHealth = {
  listenerCount: number;
  relayPathReady: boolean;
  hlsUrl: string;
  relayBytesReceived: number;
  relay: ProcessRuntime;
  ingest: ProcessRuntime;
  mp3Bridge: ProcessRuntime;
};

type RelayMetrics = {
  listenerCount: number;
  relayPathReady: boolean;
  relayBytesReceived: number;
};

type Mp3HelperStatusPayload = {
  listenerCount: number;
};

type MediaMtxPathPayload = {
  ready: boolean;
  bytesReceived: number;
};

const SETTINGS_STORAGE_KEY = "relyycast:server-config";
const MEDIAMTX_CONTROL_API_URL = "http://127.0.0.1:9997/v3/paths/list";
const CLOUDFLARE_ACTION_PENDING_TIMEOUT_MS = 1500;
const RUNTIME_STATE_POLL_MS = 2000;

const DEFAULT_SERVER_CONFIG: ServerConfig = {
  mp3Enabled: false,
  inputUrl: "http://127.0.0.1:4850/live.mp3",
  stationName: "RelyyCast Dev Stream",
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
};

const OFFLINE_PROCESS: ProcessRuntime = {
  running: false,
  lastError: null,
};

const tabs: Array<{ id: TabId; label: string; tip: string }> = [
  { id: "control", label: "Control", tip: "Cloudflare controls and stream status" },
  { id: "settings", label: "Settings", tip: "Runtime configuration" },
];

function normalizeCloudflareMode(value: unknown): CloudflareMode {
  if (value === "temporary" || value === "named") {
    return value;
  }
  return "named";
}

function normalizeServerConfig(input: unknown): ServerConfig {
  const source = input && typeof input === "object" ? (input as Partial<ServerConfig>) : {};
  const cloudflareHostname =
    typeof source.cloudflareHostname === "string"
      ? source.cloudflareHostname
      : DEFAULT_SERVER_CONFIG.cloudflareHostname;
  return {
    mp3Enabled: source.mp3Enabled === true,
    inputUrl: typeof source.inputUrl === "string" ? source.inputUrl : DEFAULT_SERVER_CONFIG.inputUrl,
    stationName: typeof source.stationName === "string" ? source.stationName : DEFAULT_SERVER_CONFIG.stationName,
    genre: typeof source.genre === "string" ? source.genre : DEFAULT_SERVER_CONFIG.genre,
    description: typeof source.description === "string" ? source.description : DEFAULT_SERVER_CONFIG.description,
    bitrate: typeof source.bitrate === "string" ? source.bitrate : DEFAULT_SERVER_CONFIG.bitrate,
    ffmpegPath: typeof source.ffmpegPath === "string" ? source.ffmpegPath : DEFAULT_SERVER_CONFIG.ffmpegPath,
    relayPath: typeof source.relayPath === "string" ? source.relayPath : DEFAULT_SERVER_CONFIG.relayPath,
    mediamtxPath: typeof source.mediamtxPath === "string" ? source.mediamtxPath : DEFAULT_SERVER_CONFIG.mediamtxPath,
    mediamtxConfigPath:
      typeof source.mediamtxConfigPath === "string"
        ? source.mediamtxConfigPath
        : DEFAULT_SERVER_CONFIG.mediamtxConfigPath,
    cloudflareMode: normalizeCloudflareMode(source.cloudflareMode),
    cloudflareHostname,
    cloudflareTunnelName:
      typeof source.cloudflareTunnelName === "string"
        ? source.cloudflareTunnelName
        : DEFAULT_SERVER_CONFIG.cloudflareTunnelName,
  };
}

function mapRuntimeConfigToServerConfig(config: RuntimeConfig): ServerConfig {
  return normalizeServerConfig({
    mp3Enabled: config.mp3Enabled,
    inputUrl: config.inputUrl,
    stationName: config.stationName,
    genre: config.genre,
    description: config.description,
    bitrate: config.bitrate,
    ffmpegPath: config.ffmpegPath,
    relayPath: config.relayPath,
    mediamtxPath: config.mediamtxPath,
    mediamtxConfigPath: config.mediamtxConfigPath,
    cloudflareMode: config.cloudflareMode,
    cloudflareHostname: config.cloudflareHostname,
    cloudflareTunnelName: config.cloudflareTunnelName,
  });
}

function mapServerConfigToRuntimeConfig(config: ServerConfig): Partial<RuntimeConfig> {
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
  };
}

function normalizeProcessRuntime(input: RuntimeProcessState | undefined): ProcessRuntime {
  if (!input) {
    return OFFLINE_PROCESS;
  }
  return {
    running: input.running === true,
    lastError: typeof input.lastError === "string" ? input.lastError : null,
  };
}

function normalizeMountPath(pathname: string | undefined) {
  if (!pathname || pathname === "/") {
    return "/live.mp3";
  }
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function buildHlsUrl(relayPath: string) {
  const normalized = relayPath.trim().replace(/^\/+|\/+$/g, "") || "live";
  return `http://127.0.0.1:8888/${normalized}/index.m3u8`;
}

function readStoredConfig(): ServerConfig | null {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return normalizeServerConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStoredConfig(config: ServerConfig) {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage write errors in restricted contexts.
  }
}

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function parseMp3HelperStatus(payload: unknown): Mp3HelperStatusPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const source = payload as {
    listenerCount?: unknown;
  };

  return {
    listenerCount: toNumber(source.listenerCount, 0),
  };
}

function parseMediaMtxPath(payload: unknown, relayPath: string): MediaMtxPathPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const source = payload as {
    items?: unknown;
  };
  if (!Array.isArray(source.items)) {
    return null;
  }

  const pathItem = source.items.find((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    return (item as { name?: unknown }).name === relayPath;
  });
  if (!pathItem || typeof pathItem !== "object") {
    return null;
  }

  const candidate = pathItem as {
    ready?: unknown;
    bytesReceived?: unknown;
  };

  return {
    ready: candidate.ready === true,
    bytesReceived: toNumber(candidate.bytesReceived, 0),
  };
}

function getRuntimeStateTimestamp(state: RuntimeState | null) {
  if (!state?.lastUpdatedAt) {
    return 0;
  }
  const timestamp = Date.parse(state.lastUpdatedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function selectNewestRuntimeState(current: RuntimeState | null, persisted: RuntimeState | null) {
  if (!current) {
    return persisted;
  }
  if (!persisted) {
    return current;
  }
  return getRuntimeStateTimestamp(persisted) >= getRuntimeStateTimestamp(current) ? persisted : current;
}

export function StationConsole() {
  const [activeTab, setActiveTab] = useState<TabId>("control");
  const [darkMode, setDarkMode] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(() => getRuntimeStateSnapshot());
  const [relayMetrics, setRelayMetrics] = useState<RelayMetrics | null>(null);
  const [serverConfig, setServerConfig] = useState<ServerConfig>(DEFAULT_SERVER_CONFIG);
  const [settingsStatus, setSettingsStatus] = useState("Waiting for runtime state.");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [cloudflareActionPending, setCloudflareActionPending] = useState<"connect" | "retry" | "skip" | null>(null);
  const [cloudflareActionError, setCloudflareActionError] = useState<string | null>(null);
  const runtimeConfigSignature = useRef<string | null>(null);

  const relayPath = runtimeState?.config.relayPath || serverConfig.relayPath || "live";
  const mountPath = normalizeMountPath(runtimeState?.config.mp3MountPath);
  const localOrigin = `http://${runtimeState?.config.mp3HelperHost || "127.0.0.1"}:${runtimeState?.config.mp3HelperPort ?? 8177}`;
  const localStreamUrl = `${localOrigin}${mountPath}`;
  const publicOrigin = runtimeState?.cloudflare.publicUrl?.replace(/\/+$/g, "") || "";
  const mp3Enabled = runtimeState?.config.mp3Enabled ?? serverConfig.mp3Enabled;
  const streamUrl = mp3Enabled ? (publicOrigin ? `${publicOrigin}${mountPath}` : localStreamUrl) : "---";
  const helperStatusUrl = `${localOrigin}/_status`;
  const fallbackHlsUrl = buildHlsUrl(relayPath);
  const publicHlsUrl = publicOrigin ? `${publicOrigin}/${relayPath}/index.m3u8` : fallbackHlsUrl;

  const streamHealth = useMemo<StreamHealth | null>(() => {
    if (!runtimeState && !relayMetrics) {
      return null;
    }

    return {
      listenerCount: relayMetrics?.listenerCount ?? 0,
      relayPathReady: relayMetrics?.relayPathReady ?? false,
      hlsUrl: publicHlsUrl,
      relayBytesReceived: relayMetrics?.relayBytesReceived ?? 0,
      relay: normalizeProcessRuntime(runtimeState?.processes.mediamtx),
      ingest: normalizeProcessRuntime(runtimeState?.processes.ffmpegIngest),
      mp3Bridge: normalizeProcessRuntime(runtimeState?.processes.ffmpegMp3Bridge),
    };
  }, [publicHlsUrl, relayMetrics, runtimeState]);

  const hlsUrl = streamHealth?.hlsUrl || publicHlsUrl;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const refreshRuntimeState = async () => {
      const current = getRuntimeStateSnapshot();
      const persisted = await getPersistedRuntimeStateSnapshot();
      const next = selectNewestRuntimeState(current, persisted);
      if (!disposed) {
        setRuntimeState(next);
      }
    };

    void refreshRuntimeState();
    const onRuntimeStateEvent = () => {
      void refreshRuntimeState();
    };
    window.addEventListener(RUNTIME_STATE_EVENT_NAME, onRuntimeStateEvent as EventListener);
    const timer = window.setInterval(() => {
      void refreshRuntimeState();
    }, RUNTIME_STATE_POLL_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener(RUNTIME_STATE_EVENT_NAME, onRuntimeStateEvent as EventListener);
    };
  }, []);

  useEffect(() => {
    const localConfig = readStoredConfig();
    if (localConfig) {
      setServerConfig(localConfig);
      setSettingsStatus("Loaded local settings.");
    }
  }, []);

  useEffect(() => {
    if (!runtimeState) {
      return;
    }

    const normalized = mapRuntimeConfigToServerConfig(runtimeState.config);
    const signature = JSON.stringify(normalized);
    if (runtimeConfigSignature.current === signature) {
      return;
    }
    runtimeConfigSignature.current = signature;

    setServerConfig(normalized);
    writeStoredConfig(normalized);
    setSettingsStatus("Synced from runtime.");
    setSettingsError(null);
  }, [runtimeState]);

  const helperRunning = runtimeState?.processes.mp3Helper.running === true;
  const relayRunning = runtimeState?.processes.mediamtx.running === true;

  useEffect(() => {
    if (!helperRunning && !relayRunning) {
      setRelayMetrics(null);
      return;
    }

    let alive = true;

    async function readRelayHealth() {
      const helperRequest: Promise<Mp3HelperStatusPayload | null> = helperRunning
        ? fetch(helperStatusUrl, { cache: "no-store" })
            .then(async (response) => {
              if (!response.ok) {
                return null;
              }
              return parseMp3HelperStatus(await response.json());
            })
            .catch(() => null)
        : Promise.resolve(null);

      const mediamtxRequest: Promise<MediaMtxPathPayload | null> = relayRunning
        ? fetch(MEDIAMTX_CONTROL_API_URL, { cache: "no-store" })
            .then(async (response) => {
              if (!response.ok) {
                return null;
              }
              return parseMediaMtxPath(await response.json(), relayPath);
            })
            .catch(() => null)
        : Promise.resolve(null);

      const [helperStatus, relayStatus] = await Promise.all([helperRequest, mediamtxRequest]);

      if (!alive) {
        return;
      }

      setRelayMetrics({
        listenerCount: helperStatus?.listenerCount ?? 0,
        relayPathReady: relayStatus?.ready ?? false,
        relayBytesReceived: relayStatus?.bytesReceived ?? 0,
      });
    }

    void readRelayHealth();
    const timer = window.setInterval(() => {
      void readRelayHealth();
    }, 5000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [helperRunning, helperStatusUrl, relayPath, relayRunning]);

  function updateServerConfig(field: keyof ServerConfig, value: string | boolean) {
    setServerConfig((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  async function saveServerConfig() {
    const payload = normalizeServerConfig(serverConfig);
    writeStoredConfig(payload);
    setIsSavingSettings(true);
    setSettingsStatus("Saving...");
    setSettingsError(null);

    try {
      const updatedRuntimeState = await updateRuntimeConfig(mapServerConfigToRuntimeConfig(payload));
      if (updatedRuntimeState) {
        const normalized = mapRuntimeConfigToServerConfig(updatedRuntimeState.config);
        runtimeConfigSignature.current = JSON.stringify(normalized);
        setRuntimeState(updatedRuntimeState);
        setServerConfig(normalized);
        writeStoredConfig(normalized);
        setSettingsStatus("Saved.");
      } else {
        setSettingsStatus("Saved locally only.");
      }
      setSettingsError(null);
    } catch (error) {
      setSettingsStatus("Save failed.");
      setSettingsError(error instanceof Error ? error.message : "Unable to save config.");
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function saveAndConnect() {
    await saveServerConfig();
    runCloudflareAction("connect");
  }

  function runCloudflareAction(action: "connect" | "retry" | "skip") {
    setCloudflareActionPending(action);
    setCloudflareActionError(null);

    let pendingReleased = false;
    const releasePending = () => {
      if (pendingReleased) {
        return;
      }
      pendingReleased = true;
      setCloudflareActionPending(null);
    };

    const timeoutId = window.setTimeout(() => {
      releasePending();
    }, CLOUDFLARE_ACTION_PENDING_TIMEOUT_MS);

    const actionPromise =
      action === "connect"
        ? requestCloudflareLogin()
        : action === "retry"
          ? retryCloudflareSetup()
          : skipCloudflareForNow();

    void actionPromise
      .then((nextState) => {
        if (nextState) {
          setRuntimeState(nextState);
          if (action !== "skip" && nextState.cloudflare.status !== "ready") {
            throw new Error(
              nextState.cloudflare.message || `Cloudflare setup is ${nextState.cloudflare.status}.`,
            );
          }
        }
      })
      .catch((error) => {
        setCloudflareActionError(
          error instanceof Error ? error.message : "Unable to complete Cloudflare action.",
        );
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        releasePending();
      });
  }

  const currentTimeLabel = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const currentDateLabel = now.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const runtimePhaseLabel = runtimeState?.phase?.toUpperCase() ?? "STARTING";
  const relayReadyBadge = streamHealth?.relayPathReady ? "Ready" : "Pending";
  const cloudflareBadge = runtimeState?.cloudflare.status ?? "pending-consent";

  return (
    <main className="h-screen overflow-hidden text-[hsl(var(--theme-text))]">
      <section className="relative flex h-full w-full flex-col overflow-hidden border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-bg))]">
        <AppWindowChrome
          appName="RelyyCast"
          subtitle="Desktop Control"
          darkMode={darkMode}
          currentTimeLabel={currentTimeLabel}
          currentDateLabel={currentDateLabel}
          statusLabel={activeTab.toUpperCase()}
          onToggleDarkMode={() => {
            setDarkMode((value) => !value);
            document.documentElement.classList.toggle("dark");
          }}
        />

        <nav className="shrink-0 border-b border-[hsl(var(--theme-border))] px-2 py-1.5">
          <div className="flex items-center gap-1">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.tip}
                  aria-pressed={active}
                  className={[
                    "inline-flex h-6 items-center justify-center rounded-sm border px-2 text-[9px] font-semibold transition-colors",
                    active
                      ? "border-[hsl(var(--theme-primary))] bg-[hsl(var(--theme-primary))] text-white"
                      : "border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] hover:bg-white/70 dark:hover:bg-white/5",
                  ].join(" ")}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="flex-1 overflow-hidden p-2">
          {renderTab(activeTab, {
            runtimeState,
            streamUrl,
            hlsUrl,
            streamHealth,
            mp3Enabled,
            serverConfig,
            settingsStatus,
            settingsError,
            isSavingSettings,
            cloudflareActionPending,
            cloudflareActionError,
            onRequestCloudflareLogin: () => {
              void runCloudflareAction("connect");
            },
            onRetryCloudflareSetup: () => {
              void runCloudflareAction("retry");
            },
            onSkipCloudflareForNow: () => {
              void runCloudflareAction("skip");
            },
            onSaveAndConnect: () => {
              void saveAndConnect();
            },
            onSettingsFieldChange: updateServerConfig,
            onSaveSettings: () => {
              void saveServerConfig();
            },
          })}
        </div>

        <AppStatusFooter
          leftStatusLabel="Runtime"
          leftStatusValue={runtimeState?.phase === "running" ? "Active" : "Starting"}
          badges={[
            { label: "Phase", value: runtimePhaseLabel },
            { label: "Relay", value: relayReadyBadge },
            { label: "CF", value: cloudflareBadge },
          ]}
        />
      </section>
    </main>
  );
}

function renderTab(
  tab: TabId,
  context: {
    runtimeState: RuntimeState | null;
    streamUrl: string;
    hlsUrl: string;
    streamHealth: StreamHealth | null;
    mp3Enabled: boolean;
    serverConfig: ServerConfig;
    settingsStatus: string;
    settingsError: string | null;
    isSavingSettings: boolean;
    cloudflareActionPending: "connect" | "retry" | "skip" | null;
    cloudflareActionError: string | null;
    onRequestCloudflareLogin: () => void;
    onRetryCloudflareSetup: () => void;
    onSkipCloudflareForNow: () => void;
    onSaveAndConnect: () => void;
    onSettingsFieldChange: (field: keyof ServerConfig, value: string | boolean) => void;
    onSaveSettings: () => void;
  },
) {
  switch (tab) {
    case "control": {
      const cloudflare = context.runtimeState?.cloudflare ?? null;
      const runtimePhase = context.runtimeState?.phase?.toUpperCase() ?? "STARTING";
      const cloudflareStatus = cloudflare?.status ?? "pending-consent";
      const cfStage = cloudflare?.setupStage ?? "idle";
      const stageLabel =
        cfStage === "creating-tunnel" ? "CREATING TUNNEL"
        : cfStage === "routing-dns" ? "ROUTING DNS"
        : cfStage === "launching" ? "LAUNCHING"
        : cloudflareStatus.toUpperCase();
      const cloudflareMessage = cloudflare?.message ?? null;
      const showRetry = cloudflare?.canRetry === true || cloudflare?.nextAction === "retry-cloudflare";
      const isNamed = context.serverConfig.cloudflareMode === "named";
      const hasBusyAction = context.cloudflareActionPending !== null;
      const isProvisioning = cloudflareStatus === "provisioning";
      const isConnectBusy = context.cloudflareActionPending === "connect";
      const isRetryBusy = context.cloudflareActionPending === "retry";
      const isSkipBusy = context.cloudflareActionPending === "skip";
      const relayReady = context.streamHealth?.relayPathReady ? "Ready" : "Pending";
      const listeners = String(context.streamHealth?.listenerCount ?? 0);
      const errorMessage = context.cloudflareActionError ?? context.settingsError;
      const statusMessage = cloudflareMessage ?? (context.settingsStatus !== "Waiting for runtime state." ? context.settingsStatus : null);
      const hasHostname = context.serverConfig.cloudflareHostname.trim().length > 0;
      const canConnect = isNamed ? hasHostname : true;
      const dnsJustProvisioned = cloudflare?.dnsJustProvisioned === true && cloudflareStatus === "ready";

      return (
        <div className="grid h-full grid-cols-2 gap-2">
          {/* Left: Cloudflare Controls */}
          <div className="flex flex-col gap-1 rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))] p-2">
            <p className="shrink-0 text-[9px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--theme-muted))]">Cloudflare</p>

            {/* Mode toggle */}
            <div className="flex shrink-0 overflow-hidden rounded-sm border border-[hsl(var(--theme-border))]">
              {(["temporary", "named"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { context.onSettingsFieldChange("cloudflareMode", mode); }}
                  className={[
                    "flex-1 h-6 text-[9px] font-semibold transition-colors",
                    context.serverConfig.cloudflareMode === mode
                      ? "bg-[hsl(var(--theme-primary))] text-white"
                      : "bg-[hsl(var(--theme-surface-alt))]",
                  ].join(" ")}
                >
                  {mode === "temporary" ? "Temp URL" : "Custom Domain"}
                </button>
              ))}
            </div>

            {isNamed ? (
              <>
                {/* Hostname */}
                <label className="shrink-0 grid gap-0.5">
                  <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-[hsl(var(--theme-muted))]">Hostname</span>
                  <input
                    type="text"
                    value={context.serverConfig.cloudflareHostname}
                    placeholder="e.g. stream.yourdomain.com"
                    onChange={(e) => { context.onSettingsFieldChange("cloudflareHostname", e.target.value); }}
                    className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-white px-1.5 text-[10px] leading-4 outline-none focus:border-[hsl(var(--theme-primary))] dark:bg-[hsl(var(--theme-surface))]"
                  />
                </label>

                {/* Tunnel Name */}
                <label className="shrink-0 grid gap-0.5">
                  <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-[hsl(var(--theme-muted))]">Tunnel Name</span>
                  <input
                    type="text"
                    value={context.serverConfig.cloudflareTunnelName}
                    onChange={(e) => { context.onSettingsFieldChange("cloudflareTunnelName", e.target.value); }}
                    className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-white px-1.5 text-[10px] leading-4 outline-none focus:border-[hsl(var(--theme-primary))] dark:bg-[hsl(var(--theme-surface))]"
                  />
                </label>

                <p className="shrink-0 text-[8px] text-[hsl(var(--theme-muted))] leading-4">
                  Clicking Connect will open Cloudflare authorization in your browser — no API token required.
                </p>

                {/* CTA */}
                <div className="shrink-0 grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={context.onSaveAndConnect}
                    disabled={hasBusyAction || isProvisioning || !canConnect}
                    className="col-span-2 h-7 rounded-sm border border-[hsl(var(--theme-primary))] bg-[hsl(var(--theme-primary))] text-[9px] font-semibold text-white disabled:opacity-60"
                  >
                    {isConnectBusy ? "Connecting…" : "Save & Connect"}
                  </button>
                  <button
                    type="button"
                    onClick={context.onSkipCloudflareForNow}
                    disabled={hasBusyAction || isProvisioning || cloudflareStatus === "ready"}
                    className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[9px] font-semibold disabled:opacity-60"
                  >
                    {isSkipBusy ? "Skipping…" : "Skip"}
                  </button>
                  <button
                    type="button"
                    onClick={context.onRetryCloudflareSetup}
                    disabled={hasBusyAction || isProvisioning || !showRetry}
                    className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[9px] font-semibold disabled:opacity-40"
                  >
                    {isRetryBusy ? "Retrying…" : "Retry"}
                  </button>
                </div>
              </>
            ) : (
              /* Temp URL mode */
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={context.onSaveAndConnect}
                  disabled={hasBusyAction || isProvisioning}
                  className="h-7 rounded-sm border border-[hsl(var(--theme-primary))] bg-[hsl(var(--theme-primary))] text-[9px] font-semibold text-white disabled:opacity-60"
                >
                  {isConnectBusy ? "Connecting…" : "Start Temp URL"}
                </button>
                <button
                  type="button"
                  onClick={context.onSkipCloudflareForNow}
                  disabled={hasBusyAction || isProvisioning || cloudflareStatus === "ready"}
                  className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[9px] font-semibold disabled:opacity-60"
                >
                  {isSkipBusy ? "Skipping…" : "Skip for Now"}
                </button>
                {showRetry ? (
                  <button
                    type="button"
                    onClick={context.onRetryCloudflareSetup}
                    disabled={hasBusyAction || isProvisioning}
                    className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[9px] font-semibold disabled:opacity-40"
                  >
                    {isRetryBusy ? "Retrying…" : "Retry"}
                  </button>
                ) : null}
              </div>
            )}

            {statusMessage ? (
              <div className="shrink-0 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-1.5 py-1 text-[9px] text-[hsl(var(--theme-muted))] leading-4">
                {statusMessage}
              </div>
            ) : null}

            {errorMessage ? (
              <div className="shrink-0 rounded-sm border border-red-500/50 bg-red-500/10 px-1.5 py-1 text-[9px] text-red-600 dark:text-red-300 leading-4">
                {errorMessage}
              </div>
            ) : null}
          </div>

          {/* Right: Status + Stream */}
          <div className="flex flex-col gap-1.5 rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))] p-2">
            <p className="shrink-0 text-[9px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--theme-muted))]">Status</p>

            <div className="grid grid-cols-2 gap-1">
              <StatusTile label="Runtime" value={runtimePhase} />
              <StatusTile label="Cloudflare" value={stageLabel} />
              <StatusTile label="Relay" value={relayReady} />
              <StatusTile label="Listeners" value={listeners} />
            </div>

            <p className="shrink-0 text-[9px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--theme-muted))]">Stream</p>

            <UrlRow
              label="MP3"
              value={context.streamUrl}
              canCopy={context.mp3Enabled}
              onCopy={() => {
                if (!context.mp3Enabled) {
                  return;
                }
                void navigator.clipboard.writeText(context.streamUrl);
              }}
            />
            <UrlRow
              label="HLS"
              value={context.hlsUrl}
              onCopy={() => { void navigator.clipboard.writeText(context.hlsUrl); }}
            />

            {dnsJustProvisioned ? (
              <div className="shrink-0 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-1 text-[9px] text-amber-700 dark:text-amber-300 leading-4">
                Tunnel ready — DNS may take 1–2 min to propagate globally.
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-1">
              <ActionButton
                disabled={!context.mp3Enabled}
                onClick={() => {
                  if (!context.mp3Enabled) {
                    return;
                  }
                  void nlOs.open(context.streamUrl);
                }}
              >
                Open MP3
              </ActionButton>
              <ActionButton onClick={() => { void nlOs.open(context.hlsUrl); }}>
                Open HLS
              </ActionButton>
            </div>
          </div>
        </div>
      );
    }
    case "settings":
      return (
        <div className="flex h-full flex-col gap-2 rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))] p-2">
          <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--theme-muted))]">Configuration</p>

          <div className="grid grid-cols-3 gap-1.5">
            <div className="col-span-3 flex items-center justify-between rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 py-1.5">
              <div>
                <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-[hsl(var(--theme-muted))]">MP3 Output</p>
                <p className="text-[9px] text-[hsl(var(--theme-muted))]">Optional Bun helper output. Enable after install, save settings, then restart the app.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  context.onSettingsFieldChange("mp3Enabled", !context.serverConfig.mp3Enabled);
                }}
                className={[
                  "h-7 rounded-sm border px-2 text-[9px] font-semibold",
                  context.serverConfig.mp3Enabled
                    ? "border-[hsl(var(--theme-primary))] bg-[hsl(var(--theme-primary))] text-white"
                    : "border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))]",
                ].join(" ")}
              >
                {context.serverConfig.mp3Enabled ? "Enabled" : "Disabled"}
              </button>
            </div>
            <ConfigField
              label="Input URL"
              value={context.serverConfig.inputUrl}
              onChange={(value) => { context.onSettingsFieldChange("inputUrl", value); }}
            />
            <ConfigField
              label="Station Name"
              value={context.serverConfig.stationName}
              onChange={(value) => { context.onSettingsFieldChange("stationName", value); }}
            />
            <ConfigField
              label="Bitrate"
              value={context.serverConfig.bitrate}
              onChange={(value) => { context.onSettingsFieldChange("bitrate", value); }}
            />
            <ConfigField
              label="Relay Path"
              value={context.serverConfig.relayPath}
              onChange={(value) => { context.onSettingsFieldChange("relayPath", value); }}
            />
            <ConfigField
              label="Genre"
              value={context.serverConfig.genre}
              onChange={(value) => { context.onSettingsFieldChange("genre", value); }}
            />
            <ConfigField
            
              label="Description"
              value={context.serverConfig.description}
              onChange={(value) => { context.onSettingsFieldChange("description", value); }}
            />
                   <div className="hidden">
            <ConfigField
              label="FFmpeg Path"
              value={context.serverConfig.ffmpegPath}
              onChange={(value) => { context.onSettingsFieldChange("ffmpegPath", value); }}
            />
     
            <ConfigField
              label="MediaMTX Path"
              value={context.serverConfig.mediamtxPath}
              onChange={(value) => { context.onSettingsFieldChange("mediamtxPath", value); }}
            />
            <ConfigField
              label="MediaMTX Config"
              value={context.serverConfig.mediamtxConfigPath}
              onChange={(value) => { context.onSettingsFieldChange("mediamtxConfigPath", value); }}
            />
            </div>
          </div>

          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-1">
            <button
              type="button"
              onClick={context.onSaveSettings}
              disabled={context.isSavingSettings}
              className="h-7 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[9px] font-semibold disabled:opacity-60"
            >
              {context.isSavingSettings ? "Saving…" : "Save Settings"}
            </button>
            <div className="truncate rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-1.5 py-1 text-[9px] text-[hsl(var(--theme-muted))]">
              {context.settingsError ? `Error: ${context.settingsError}` : context.settingsStatus}
            </div>
          </div>
        </div>
      );
    default:
      return null;
  }
}

function StatusTile({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 py-1 flex items-baseline gap-2">
      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--theme-muted))]">{label}</p>
      <p className="mt-0.5 truncate text-[10px]" title={value}>{value}</p>
    </div>
  );
}

function UrlRow({
  label,
  value,
  canCopy = true,
  onCopy,
}: Readonly<{ label: string; value: string; canCopy?: boolean; onCopy: () => void }>) {
  return (
    <div className="grid grid-cols-[32px_minmax(0,1fr)_48px] items-center gap-1 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-1.5 py-1">
      <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-[hsl(var(--theme-muted))]">{label}</span>
      <span className="truncate font-mono text-[9px]" title={value}>{value}</span>
      <button
        type="button"
        onClick={onCopy}
        disabled={!canCopy}
        className="h-5 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))] text-[8px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      >
        Copy
      </button>
    </div>
  );
}

function ConfigField({
  label,
  value,
  onChange,
  disabled = false,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}>) {
  return (
    <label className={["grid gap-0.5 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-1.5 py-1", disabled ? "opacity-50" : ""].join(" ")}>
      <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-[hsl(var(--theme-muted))]">{label}</span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(event) => { onChange(event.target.value); }}
        className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-white px-1.5 text-[10px] leading-4 outline-none focus:border-[hsl(var(--theme-primary))] disabled:cursor-not-allowed dark:bg-[hsl(var(--theme-surface))]"
      />
    </label>
  );
}

function ActionButton({
  children,
  disabled = false,
  onClick,
}: Readonly<{
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 items-center justify-center rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-1.5 text-[9px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

