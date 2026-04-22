import { useEffect, useMemo, useRef, useState } from "react";
import {
  requestCloudflareLogin,
  retryCloudflareSetup,
  skipCloudflareForNow,
  updateRuntimeConfig,
} from "@/src/runtime/neutralino-runtime-orchestrator";
import AppStatusFooter from "@/components/chrome/AppStatusFooter";
import AppWindowChrome from "@/components/chrome/AppWindowChrome";
import {
  CLOUDFLARE_ACTION_PENDING_TIMEOUT_MS,
  DEFAULT_SERVER_CONFIG,
  mapRuntimeConfigToServerConfig,
  mapServerConfigToRuntimeConfig,
  normalizeServerConfig,
  readStoredConfig,
  writeStoredConfig,
} from "@/src/lib/station-config";
import {
  buildHlsUrl,
  buildMp3HealthDevProxyUrl,
  buildMp3HealthUrl,
  normalizeMountPath,
  parseHttpInputUrl,
} from "@/src/lib/stream-urls";
import { normalizeProcessRuntime } from "@/src/lib/runtime-state";
import { useRuntimeState } from "@/src/hooks/useRuntimeState";
import { useRelayMetrics } from "@/src/hooks/useRelayMetrics";
import { ControlTab } from "./ControlTab";
import { SettingsTab } from "./SettingsTab";

const tabs: Array<{ id: TabId; label: string; tip: string }> = [
  { id: "control", label: "Control", tip: "Cloudflare controls and stream status" },
  { id: "settings", label: "Settings", tip: "Runtime configuration" },
];

export function StationConsole() {
  const [activeTab, setActiveTab] = useState<TabId>("control");
  const [darkMode, setDarkMode] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [serverConfig, setServerConfig] = useState<ServerConfig>(DEFAULT_SERVER_CONFIG);
  const [settingsStatus, setSettingsStatus] = useState("Waiting for runtime state.");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [cloudflareActionPending, setCloudflareActionPending] = useState<"connect" | "retry" | "skip" | null>(null);
  const [cloudflareActionError, setCloudflareActionError] = useState<string | null>(null);
  const runtimeConfigSignature = useRef<string | null>(null);

  const [runtimeState, setRuntimeState] = useRuntimeState();

  // Derive relay path from live runtime state, falling back to local config.
  const relayPath = (runtimeState?.config.relayPath || serverConfig.relayPath || "live").trim() || "live";
  const normalizedRelayPath = relayPath.replace(/^\/+|\/+$/g, "") || "live";

  const mp3Enabled = runtimeState?.config.mp3Enabled ?? serverConfig.mp3Enabled;
  const isDevBuild = import.meta.env.DEV;
  const inputUrl = runtimeState?.config.inputUrl || serverConfig.inputUrl || DEFAULT_SERVER_CONFIG.inputUrl;
  const parsedInputUrl = useMemo(() => parseHttpInputUrl(inputUrl), [inputUrl]);
  const mountPath = normalizeMountPath(parsedInputUrl?.pathname);
  const inputOrigin = parsedInputUrl?.origin || "http://127.0.0.1:4850";
  const localStreamUrl = `${inputOrigin}${mountPath}`;
  const publicOrigin = runtimeState?.cloudflare.publicUrl?.replace(/\/+$/g, "") || "";
  const streamUrl = mp3Enabled ? (publicOrigin ? `${publicOrigin}${mountPath}` : localStreamUrl) : "---";
  const mp3HealthUrl = useMemo(
    () => (isDevBuild ? buildMp3HealthUrl(parsedInputUrl) : null),
    [isDevBuild, parsedInputUrl],
  );
  const mp3HealthDevProxyUrl = useMemo(
    () => (isDevBuild ? buildMp3HealthDevProxyUrl(parsedInputUrl) : null),
    [isDevBuild, parsedInputUrl],
  );

  const relayRunning = runtimeState?.processes.mediamtx.running === true;
  const ingestRunning = runtimeState?.processes.ffmpegIngest.running === true;

  const relayMetrics = useRelayMetrics({
    relayRunning,
    ingestRunning,
    relayPath,
    mp3HealthUrl,
    mp3HealthDevProxyUrl,
  });

  const fallbackHlsUrl = buildHlsUrl(normalizedRelayPath);
  const publicHlsUrl = publicOrigin
    ? `${publicOrigin}/${normalizedRelayPath}/index.m3u8`
    : fallbackHlsUrl;

  const streamHealth = useMemo<StreamHealth | null>(() => {
    if (!runtimeState && !relayMetrics) return null;
    return {
      listenerCount: relayMetrics?.listenerCount ?? 0,
      relayPathReady: relayMetrics?.relayPathReady ?? false,
      hlsUrl: publicHlsUrl,
      relayBytesReceived: relayMetrics?.relayBytesReceived ?? 0,
      relay: normalizeProcessRuntime(runtimeState?.processes.mediamtx),
      ingest: normalizeProcessRuntime(runtimeState?.processes.ffmpegIngest),
    };
  }, [publicHlsUrl, relayMetrics, runtimeState]);

  const hlsUrl = streamHealth?.hlsUrl ?? publicHlsUrl;

  // Clock tick — updates the header timestamp every 30s.
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(new Date()); }, 30_000);
    return () => { window.clearInterval(timer); };
  }, []);

  // Bootstrap from localStorage on first render.
  useEffect(() => {
    const stored = readStoredConfig();
    if (stored) {
      setServerConfig(stored);
      setSettingsStatus("Loaded local settings.");
    }
  }, []);

  // Sync server config whenever the runtime pushes a new config.
  useEffect(() => {
    if (!runtimeState) return;
    const normalized = mapRuntimeConfigToServerConfig(runtimeState.config);
    const signature = JSON.stringify(normalized);
    if (runtimeConfigSignature.current === signature) return;
    runtimeConfigSignature.current = signature;
    setServerConfig(normalized);
    writeStoredConfig(normalized);
    setSettingsStatus("Connected");
    setSettingsError(null);
  }, [runtimeState]);

  function updateServerConfig(field: keyof ServerConfig, value: string | boolean) {
    setServerConfig((prev) => ({ ...prev, [field]: value }));
  }

  async function saveServerConfig() {
    const payload = normalizeServerConfig(serverConfig);
    writeStoredConfig(payload);
    setIsSavingSettings(true);
    setSettingsStatus("Saving...");
    setSettingsError(null);

    try {
      const updatedState = await updateRuntimeConfig(mapServerConfigToRuntimeConfig(payload));
      if (updatedState) {
        const normalized = mapRuntimeConfigToServerConfig(updatedState.config);
        runtimeConfigSignature.current = JSON.stringify(normalized);
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

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      setCloudflareActionPending(null);
    };

    // Minimum visible feedback duration so UI doesn't flash.
    const timeoutId = window.setTimeout(release, CLOUDFLARE_ACTION_PENDING_TIMEOUT_MS);

    const actionPromise =
      action === "connect" ? requestCloudflareLogin()
      : action === "retry" ? retryCloudflareSetup()
      : skipCloudflareForNow();

    void actionPromise
      .then((nextState) => {
        if (nextState) {
          setRuntimeState(nextState);
          if (action !== "skip" && nextState.cloudflare.status === "error") {
            throw new Error(nextState.cloudflare.message || "Cloudflare setup failed.");
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
        release();
      });
  }

  const currentTimeLabel = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const currentDateLabel = now.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  const runtimePhaseLabel = runtimeState?.phase?.toUpperCase() ?? "Starting";
  const relayReadyBadge = streamHealth?.relayPathReady ? "Ready" : "Pending";
  const cloudflareBadge = runtimeState?.cloudflare.status ?? "pending-consent";

  const sharedCloudflareProps = {
    onSaveAndConnect: () => { void saveAndConnect(); },
    onRetryCloudflareSetup: () => { void runCloudflareAction("retry"); },
    onSkipCloudflareForNow: () => { void runCloudflareAction("skip"); },
    onSettingsFieldChange: updateServerConfig,
    cloudflareActionPending,
    cloudflareActionError,
    serverConfig,
    settingsStatus,
    settingsError,
  };

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
            setDarkMode((v) => !v);
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
                  onClick={() => { setActiveTab(tab.id); }}
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
          {activeTab === "control" && (
            <ControlTab
              {...sharedCloudflareProps}
              runtimeState={runtimeState}
              streamUrl={streamUrl}
              hlsUrl={hlsUrl}
              streamHealth={streamHealth}
              mp3Enabled={mp3Enabled}
            />
          )}
          {activeTab === "settings" && (
            <SettingsTab
              serverConfig={serverConfig}
              settingsStatus={settingsStatus}
              settingsError={settingsError}
              isSavingSettings={isSavingSettings}
              onSettingsFieldChange={updateServerConfig}
              onSaveSettings={() => { void saveServerConfig(); }}
            />
          )}
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
