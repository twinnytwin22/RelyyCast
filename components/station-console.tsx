

import { useEffect, useState } from "react";
import AgentOperationsPanel from "@/components/agent-operations-panel";
import AppStatusFooter from "@/components/chrome/AppStatusFooter";
import AppWindowChrome from "@/components/chrome/AppWindowChrome";

type TabId = "overview" | "stream" | "agent" | "settings" | "log";

type ServerConfig = {
  inputUrl: string;
  stationName: string;
  genre: string;
  description: string;
  bitrate: string;
  ffmpegPath: string;
  relayPath: string;
  mediamtxPath: string;
  mediamtxConfigPath: string;
};

type ProcessRuntime = {
  running: boolean;
  lastStartAt: string | null;
  lastExitAt: string | null;
  lastExitCode: number | null;
  lastError: string | null;
};

type StreamHealth = {
  listenerCount: number;
  bytesIn: number;
  chunkCount: number;
  lastChunkAt: string | null;
  relayPathReady: boolean;
  hlsUrl: string;
  relay: ProcessRuntime;
  ingest: ProcessRuntime;
  mp3Bridge: ProcessRuntime;
};

const SETTINGS_STORAGE_KEY = "relyycast:server-config";

const DEFAULT_SERVER_CONFIG: ServerConfig = {
  inputUrl: "http://127.0.0.1:4850/live.mp3",
  stationName: "RelyyCast Dev Stream",
  genre: "Various",
  description: "Local FFmpeg test source",
  bitrate: "128k",
  ffmpegPath: "",
  relayPath: "live",
  mediamtxPath: "",
  mediamtxConfigPath: "",
};

function normalizeServerConfig(input: unknown): ServerConfig {
  const source = input && typeof input === "object" ? (input as Partial<ServerConfig>) : {};
  return {
    inputUrl: typeof source.inputUrl === "string" ? source.inputUrl : DEFAULT_SERVER_CONFIG.inputUrl,
    stationName: typeof source.stationName === "string" ? source.stationName : DEFAULT_SERVER_CONFIG.stationName,
    genre: typeof source.genre === "string" ? source.genre : DEFAULT_SERVER_CONFIG.genre,
    description: typeof source.description === "string" ? source.description : DEFAULT_SERVER_CONFIG.description,
    bitrate: typeof source.bitrate === "string" ? source.bitrate : DEFAULT_SERVER_CONFIG.bitrate,
    ffmpegPath: typeof source.ffmpegPath === "string" ? source.ffmpegPath : DEFAULT_SERVER_CONFIG.ffmpegPath,
    relayPath: typeof source.relayPath === "string" ? source.relayPath : DEFAULT_SERVER_CONFIG.relayPath,
    mediamtxPath: typeof source.mediamtxPath === "string" ? source.mediamtxPath : DEFAULT_SERVER_CONFIG.mediamtxPath,
    mediamtxConfigPath:
      typeof source.mediamtxConfigPath === "string" ? source.mediamtxConfigPath : DEFAULT_SERVER_CONFIG.mediamtxConfigPath,
  };
}

function normalizeProcessRuntime(input: unknown): ProcessRuntime {
  const source = input && typeof input === "object" ? (input as Partial<ProcessRuntime>) : {};
  return {
    running: source.running === true,
    lastStartAt: typeof source.lastStartAt === "string" ? source.lastStartAt : null,
    lastExitAt: typeof source.lastExitAt === "string" ? source.lastExitAt : null,
    lastExitCode: typeof source.lastExitCode === "number" ? source.lastExitCode : null,
    lastError: typeof source.lastError === "string" ? source.lastError : null,
  };
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
    // Ignore storage write errors in private/incognito contexts.
  }
}

const tabs: Array<{ id: TabId; label: string; tip: string }> = [
  {
    id: "overview",
    label: "Overview",
    tip: "The quick station summary and current live state.",
  },
  {
    id: "stream",
    label: "Stream",
    tip: "Public MP3 and HLS URLs plus relay diagnostics.",
  },
  {
    id: "agent",
    label: "Agent",
    tip: "Desktop pairing and heartbeat status.",
  },
  {
    id: "settings",
    label: "Settings",
    tip: "Server input, metadata, and FFmpeg runtime options.",
  },
  {
    id: "log",
    label: "Log",
    tip: "Recent operator events and state changes.",
  },
];

const events = [
  "Desktop approved and config delivered.",
  "cloudflared token rotated successfully.",
  "Audio source switched to BlackHole 2ch.",
  "Listener count held below the soft limit.",
];

export function StationConsole() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [darkMode, setDarkMode] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [streamHealth, setStreamHealth] = useState<StreamHealth | null>(null);
  const [serverConfig, setServerConfig] = useState<ServerConfig>(DEFAULT_SERVER_CONFIG);
  const [settingsStatus, setSettingsStatus] = useState("Waiting for config sync.");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const serverUrl = import.meta.env.VITE_SERVER_URL ?? "http://127.0.0.1:8177";
  const streamUrl = `${serverUrl}/live.mp3`;
  const fallbackHlsUrl = `${serverUrl}/hls/${serverConfig.relayPath || "live"}/index.m3u8`;
  const hlsUrl = streamHealth?.hlsUrl || fallbackHlsUrl;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;

    async function readHealth() {
      try {
        const response = await fetch(`${serverUrl}/health`, { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const json = (await response.json()) as {
          listenerCount: number;
          bytesIn: number;
          chunkCount: number;
          lastChunkAt: string | null;
          relayPathReady?: boolean;
          hlsUrl?: string;
          relay?: unknown;
          ingest?: unknown;
          mp3Bridge?: unknown;
        };

        const hlsPath = typeof json.hlsUrl === "string" && json.hlsUrl
          ? json.hlsUrl
          : `/hls/${serverConfig.relayPath || "live"}/index.m3u8`;

        if (alive) {
          setStreamHealth({
            listenerCount: json.listenerCount,
            bytesIn: json.bytesIn,
            chunkCount: json.chunkCount,
            lastChunkAt: json.lastChunkAt,
            relayPathReady: json.relayPathReady === true,
            hlsUrl: hlsPath.startsWith("http")
              ? hlsPath
              : `${serverUrl}${hlsPath.startsWith("/") ? hlsPath : `/${hlsPath}`}`,
            relay: normalizeProcessRuntime(json.relay),
            ingest: normalizeProcessRuntime(json.ingest),
            mp3Bridge: normalizeProcessRuntime(json.mp3Bridge),
          });
        }
      } catch {
        if (alive) {
          setStreamHealth(null);
        }
      }
    }

    void readHealth();
    const timer = window.setInterval(() => {
      void readHealth();
    }, 5000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [serverUrl, serverConfig.relayPath]);

  useEffect(() => {
    let alive = true;
    const localConfig = readStoredConfig();
    if (localConfig) {
      setServerConfig(localConfig);
      setSettingsStatus("Loaded local settings.");
    }

    async function syncConfigFromServer() {
      try {
        const response = await fetch(`${serverUrl}/api/config`, { cache: "no-store" });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = typeof (json as { error?: unknown }).error === "string"
            ? (json as { error: string }).error
            : `Config sync failed with status ${response.status}`;
          throw new Error(message);
        }

        const normalized = normalizeServerConfig(json);
        if (!alive) {
          return;
        }

        setServerConfig(normalized);
        writeStoredConfig(normalized);
        setSettingsStatus("Synced with server config.");
        setSettingsError(null);
      } catch (error) {
        if (!alive) {
          return;
        }
        setSettingsStatus(localConfig ? "Using local settings." : "No local settings found.");
        setSettingsError(error instanceof Error ? error.message : "Unable to sync config.");
      }
    }

    void syncConfigFromServer();

    return () => {
      alive = false;
    };
  }, [serverUrl]);

  function updateServerConfig(field: keyof ServerConfig, value: string) {
    setServerConfig((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  async function saveServerConfig() {
    const payload = normalizeServerConfig(serverConfig);
    writeStoredConfig(payload);
    setIsSavingSettings(true);
    setSettingsStatus("Saving settings...");
    setSettingsError(null);

    try {
      const response = await fetch(`${serverUrl}/api/config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof (json as { error?: unknown }).error === "string"
          ? (json as { error: string }).error
          : `Config save failed with status ${response.status}`;
        throw new Error(message);
      }

      const normalized = normalizeServerConfig(json);
      setServerConfig(normalized);
      writeStoredConfig(normalized);
      setSettingsStatus("Saved to localStorage and server.");
      setSettingsError(null);
    } catch (error) {
      setSettingsStatus("Save failed.");
      setSettingsError(error instanceof Error ? error.message : "Unable to save config.");
    } finally {
      setIsSavingSettings(false);
    }
  }

  const currentTimeLabel = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const currentDateLabel = now.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <main className="h-screen overflow-hidden text-[hsl(var(--theme-text))]">
      <section className="flex h-full w-full flex-col overflow-hidden border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))]">
        <AppWindowChrome
          appName="RelyyCast Control Plane"
          subtitle="RelyyCast / Server GUI"
          darkMode={darkMode}
          currentTimeLabel={currentTimeLabel}
          currentDateLabel={currentDateLabel}
          statusLabel={activeTab.toUpperCase()}
          onToggleDarkMode={() => {
            setDarkMode((value) => !value);
            document.documentElement.classList.toggle("dark");
          }}
        />

        <div className="flex-1 overflow-hidden">
          <nav className="flex flex-wrap items-center gap-1 border-b border-[hsl(var(--theme-border))] px-2 py-1.5">
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
                    "inline-flex h-7 items-center justify-center rounded-sm border px-2.5 text-[10px] font-semibold transition-colors",
                    active
                      ? "border-[hsl(var(--theme-primary))] bg-[hsl(var(--theme-primary))] text-white"
                      : "border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[hsl(var(--theme-text))] hover:bg-white/70 dark:hover:bg-white/5",
                  ].join(" ")}
                >
                  {tab.label}
                </button>
              );
            })}

          </nav>

          <div className="grid gap-2.5 p-2.5 grid-cols-[1fr_485px]">
            <section className="space-y-2.5">
              <Panel
                eyebrow={tabMeta[activeTab].eyebrow}
                title={tabMeta[activeTab].title}
                body={tabMeta[activeTab].body}
              >
                {renderTab(activeTab, {
                  streamUrl,
                  hlsUrl,
                  streamHealth,
                  serverConfig,
                  settingsStatus,
                  settingsError,
                  isSavingSettings,
                  onSettingsFieldChange: updateServerConfig,
                  onSaveSettings: () => {
                    void saveServerConfig();
                  },
                })}
              </Panel>
            </section>

            <aside className="space-y-2.5">
              <Panel eyebrow="State" title="Core values" body="">
                <div className="grid gap-1.5">
                  {statsForView(streamUrl, hlsUrl).map((item) => (
                    <ValueRow
                      key={item.label}
                      label={item.label}
                      value={item.value}
                    />
                  ))}
                </div>
              </Panel>
            </aside>
          </div>
        </div>

        <AppStatusFooter
          leftStatusLabel="Bridge"
          leftStatusValue="Desktop agent connected and stream endpoint reachable"
          badges={[
            { label: "Live", value: "On" },
            { label: "Agent", value: "Online" },
            { label: "Settings", value: "Loaded" },
          ]}
        />
      </section>
    </main>
  );
}

const tabMeta: Record<TabId, { eyebrow: string; title: string; body: string | null }> = {
  overview: {
    eyebrow: "Overview",
    title: "Station at a glance",
    body: null,
  },
  stream: {
    eyebrow: "Stream",
    title: "Public MP3 + HLS endpoints",
    body: "Playback, relay health, and process status.",
  },
  agent: {
    eyebrow: "Agent",
    title: "Desktop pairing and heartbeat",
    body: "Pairing and health.",
  },
  settings: {
    eyebrow: "Settings",
    title: "Server runtime configuration",
    body: "Local cache first, then sync to server config.",
  },
  log: {
    eyebrow: "Log",
    title: "Recent events",
    body: "Recent events.",
  },
};

function renderTab(
  tab: TabId,
  context: {
    streamUrl: string;
    hlsUrl: string;
    streamHealth: StreamHealth | null;
    serverConfig: ServerConfig;
    settingsStatus: string;
    settingsError: string | null;
    isSavingSettings: boolean;
    onSettingsFieldChange: (field: keyof ServerConfig, value: string) => void;
    onSaveSettings: () => void;
  },
) {
  switch (tab) {
    case "overview":
      return (
        <div className="grid gap-1.5  grid-cols-2">
          <MiniMetric
            label="Live state"
            value="Public bridge live"
            tip="The web URL is up and the agent is online."
          />
          <MiniMetric
            label="Agent state"
            value="Heartbeat 12s ago"
            tip="The desktop app is still sending health checks."
          />
          <MiniMetric
            label="Soft limit"
            value="64 listeners"
            tip="A conservative listener target for the current bitrate."
          />
          <MiniMetric
            label="Local port"
            value="8177"
            tip="The local MP3 origin listens here on the desktop machine."
          />
          <MiniMetric
            label="Chunks in"
            value={context.streamHealth ? String(context.streamHealth.chunkCount) : "offline"}
            tip="How many encoded chunks reached the local stream origin."
          />
          <MiniMetric
            label="Listeners"
            value={context.streamHealth ? String(context.streamHealth.listenerCount) : "offline"}
            tip="Current active listeners on the local stream origin."
          />
        </div>
      );
    case "stream":
      return (
        <div className="space-y-1.5">
          <ValueRow label="MP3 URL" value={context.streamUrl} />
          <ValueRow label="HLS URL" value={context.hlsUrl} />
          <div className="grid gap-1.5 sm:grid-cols-4">
            <ActionButton
              tip="Copy the public MP3 URL to your clipboard."
              onClick={() => {
                void navigator.clipboard.writeText(context.streamUrl);
              }}
            >
              Copy MP3
            </ActionButton>
            <ActionButton
              tip="Open the MP3 URL in a new player or browser tab."
              onClick={() => {
                window.open(context.streamUrl, "_blank", "noopener,noreferrer");
              }}
            >
              Open MP3
            </ActionButton>
            <ActionButton
              tip="Open the proxied HLS playlist."
              onClick={() => {
                window.open(context.hlsUrl, "_blank", "noopener,noreferrer");
              }}
            >
              Open HLS
            </ActionButton>
            <ActionButton
              tip="Read local health to verify the relay and bridge are reachable."
              onClick={() => {
                window.open(`${context.streamUrl.replace("/live.mp3", "")}/health`, "_blank", "noopener,noreferrer");
              }}
            >
              Open health
            </ActionButton>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-3">
            <ValueRow
              label="Listeners"
              value={context.streamHealth ? String(context.streamHealth.listenerCount) : "unavailable"}
            />
            <ValueRow
              label="Chunks received"
              value={context.streamHealth ? String(context.streamHealth.chunkCount) : "unavailable"}
            />
            <ValueRow
              label="Bytes ingested"
              value={context.streamHealth ? String(context.streamHealth.bytesIn) : "unavailable"}
            />
            <ValueRow
              label="Relay path"
              value={context.streamHealth?.relayPathReady ? "ready" : "pending"}
            />
            <ValueRow
              label="Relay process"
              value={formatProcessState(context.streamHealth?.relay)}
            />
            <ValueRow
              label="Ingest process"
              value={formatProcessState(context.streamHealth?.ingest)}
            />
            <ValueRow
              label="MP3 bridge"
              value={formatProcessState(context.streamHealth?.mp3Bridge)}
            />
            <ValueRow
              label="Last chunk"
              value={
                context.streamHealth?.lastChunkAt
                  ? new Date(context.streamHealth.lastChunkAt).toLocaleTimeString()
                  : "unavailable"
              }
            />
          </div>
          <div className="rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2.5 py-2 text-[12px] leading-5 text-[hsl(var(--theme-muted))]">
            The stream stays public while the encoder and tunnel run locally. If the desktop
            app stops, the station stops.
          </div>
        </div>
      );
    case "agent":
      return <AgentOperationsPanel />;
    case "settings":
      return (
        <div className="space-y-1.5">
          <ConfigField
            label="Input URL"
            value={context.serverConfig.inputUrl}
            placeholder="http://127.0.0.1:4850/live.mp3"
            onChange={(value) => {
              context.onSettingsFieldChange("inputUrl", value);
            }}
          />
          <ConfigField
            label="Station Name"
            value={context.serverConfig.stationName}
            placeholder="RelyyCast Dev Stream"
            onChange={(value) => {
              context.onSettingsFieldChange("stationName", value);
            }}
          />
          <ConfigField
            label="Genre"
            value={context.serverConfig.genre}
            placeholder="Various"
            onChange={(value) => {
              context.onSettingsFieldChange("genre", value);
            }}
          />
          <ConfigField
            label="Description"
            value={context.serverConfig.description}
            placeholder="Local FFmpeg test source"
            onChange={(value) => {
              context.onSettingsFieldChange("description", value);
            }}
          />
          <ConfigField
            label="Bitrate"
            value={context.serverConfig.bitrate}
            placeholder="128k"
            onChange={(value) => {
              context.onSettingsFieldChange("bitrate", value);
            }}
          />
          <ConfigField
            label="FFmpeg Path"
            value={context.serverConfig.ffmpegPath}
            placeholder="C:\\ffmpeg\\bin\\ffmpeg.exe"
            onChange={(value) => {
              context.onSettingsFieldChange("ffmpegPath", value);
            }}
          />
          <ConfigField
            label="Relay Path"
            value={context.serverConfig.relayPath}
            placeholder="live"
            onChange={(value) => {
              context.onSettingsFieldChange("relayPath", value);
            }}
          />
          <ConfigField
            label="MediaMTX Path"
            value={context.serverConfig.mediamtxPath}
            placeholder="mediamtx\\win\\mediamtx.exe"
            onChange={(value) => {
              context.onSettingsFieldChange("mediamtxPath", value);
            }}
          />
          <ConfigField
            label="MediaMTX Config Path"
            value={context.serverConfig.mediamtxConfigPath}
            placeholder="mediamtx\\mediamtx.yml"
            onChange={(value) => {
              context.onSettingsFieldChange("mediamtxConfigPath", value);
            }}
          />
          <button
            type="button"
            onClick={context.onSaveSettings}
            disabled={context.isSavingSettings}
            className="h-8 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[11px] font-semibold hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/5"
          >
            {context.isSavingSettings ? "Saving..." : "Save settings"}
          </button>
          <div className="rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2.5 py-2 text-[12px] leading-5 text-[hsl(var(--theme-muted))]">
            <p>{context.settingsStatus}</p>
            {context.settingsError ? <p className="text-red-500">Error: {context.settingsError}</p> : null}
          </div>
        </div>
      );
    case "log":
      return (
        <div className="space-y-1.5">
          {events.map((event, index) => (
            <div
              key={event}
              className="flex items-start gap-2.5 rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2.5 py-2"
            >
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[hsl(var(--theme-muted))]">
                0{index + 1}
              </span>
              <p className="text-[12px] leading-5">{event}</p>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

function Panel({
  eyebrow,
  title,
  body,
  children,
}: Readonly<{
  eyebrow: string;
  title: string;
  body: string | null;
  children: React.ReactNode;
}>) {
  return (
    <div className="rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))] p-2.5">
      <div className="flex items-center gap-1.5">
        <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--theme-muted))]">
          {eyebrow}
        </p>
      </div>
      <h2 className="mt-1 text-[12px] font-semibold leading-4">{title}</h2>
      {body ? (
        <p className="mt-1 text-[11px] leading-4 text-[hsl(var(--theme-muted))]">{body}</p>
      ) : null}
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

function ValueRow({
  label,
  value,
}: Readonly<{
  label: string;
  value: string;
}>) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2.5 py-1.5">
      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[hsl(var(--theme-muted))]">
        {label}
      </span>
      <span className="min-w-0 break-all text-right font-mono text-[12px] leading-5">{value}</span>
    </div>
  );
}

function ConfigField({
  label,
  value,
  placeholder,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}>) {
  return (
    <label className="grid gap-1 rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2.5 py-2">
      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[hsl(var(--theme-muted))]">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-8 rounded-sm border border-[hsl(var(--theme-border))] bg-white px-2 text-[12px] leading-5 outline-none ring-0 transition-colors focus:border-[hsl(var(--theme-primary))] dark:bg-[hsl(var(--theme-surface))]"
      />
    </label>
  );
}

function MiniMetric({
  label,
  value,
  tip,
}: Readonly<{
  label: string;
  value: string;
  tip: string;
}>) {
  return (
    <div className="rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2.5 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[hsl(var(--theme-muted))]">
          {label}
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-5" title={tip}>
        {value}
      </p>
    </div>
  );
}

function ActionButton({
  children,
  tip,
  onClick,
}: Readonly<{
  children: React.ReactNode;
  tip: string;
  onClick?: () => void;
}>) {
  return (
    <button
      type="button"
      title={tip}
      onClick={onClick}
      className="inline-flex h-8 items-center justify-center rounded-sm border border-[hsl(var(--theme-border))] bg-white px-3 text-[11px] font-semibold transition-colors hover:bg-slate-50 dark:bg-[hsl(var(--theme-surface-alt))] dark:hover:bg-white/5"
    >
      {children}
    </button>
  );
}

function formatProcessState(process: ProcessRuntime | undefined) {
  if (!process) {
    return "unavailable";
  }

  if (process.running) {
    return "running";
  }

  if (process.lastError) {
    return `error (${process.lastError})`;
  }

  if (process.lastExitCode !== null) {
    return `stopped (${process.lastExitCode})`;
  }

  return "stopped";
}

function statsForView(streamUrl: string, hlsUrl: string) {
  return [
    { label: "MP3 URL", value: streamUrl },
    { label: "HLS URL", value: hlsUrl },
    { label: "Default host", value: "wxyz.stream.relyycast.com" },
    { label: "Input", value: "BlackHole 2ch" },
    { label: "Relay", value: "MediaMTX + MP3 bridge" },
  ];
}

