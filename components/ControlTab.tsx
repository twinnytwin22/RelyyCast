import { os as nlOs } from "@neutralinojs/lib";
import type { RuntimeState } from "@/src/runtime/neutralino-runtime-orchestrator";
import { ActionButton } from "./ActionButton";
import { StatusTile } from "./StatusTitle";
import { UrlRow } from "./UrlRow";

interface ControlTabProps {
  runtimeState: RuntimeState | null;
  streamUrl: string;
  hlsUrl: string;
  streamHealth: StreamHealth | null;
  mp3Enabled: boolean;
  serverConfig: ServerConfig;
  settingsStatus: string;
  settingsError: string | null;
  cloudflareActionPending: "connect" | "retry" | "skip" | null;
  cloudflareActionError: string | null;
  onSettingsFieldChange: (field: keyof ServerConfig, value: string | boolean) => void;
  onSaveAndConnect: () => void;
  onRetryCloudflareSetup: () => void;
  onSkipCloudflareForNow: () => void;
}

export function ControlTab({
  runtimeState,
  streamUrl,
  hlsUrl,
  streamHealth,
  mp3Enabled,
  serverConfig,
  settingsStatus,
  settingsError,
  cloudflareActionPending,
  cloudflareActionError,
  onSettingsFieldChange,
  onSaveAndConnect,
  onRetryCloudflareSetup,
  onSkipCloudflareForNow,
}: Readonly<ControlTabProps>) {
  const cloudflare = runtimeState?.cloudflare ?? null;
  const runtimePhase = runtimeState?.phase?.toUpperCase() ?? "STARTING";
  const cloudflareStatus = cloudflare?.status ?? "pending-consent";

  const cfStage = cloudflare?.setupStage ?? "idle";
  const stageLabel =
    cfStage === "creating-tunnel" ? "CREATING TUNNEL"
    : cfStage === "routing-dns" ? "ROUTING DNS"
    : cfStage === "launching" ? "LAUNCHING"
    : cloudflareStatus.toUpperCase();

  const cloudflareMessage = cloudflare?.message ?? null;
  const showRetry = cloudflare?.canRetry === true || cloudflare?.nextAction === "retry-cloudflare";
  const isNamed = serverConfig.cloudflareMode === "named";
  const hasBusyAction = cloudflareActionPending !== null;
  const isProvisioning = cloudflareStatus === "provisioning";
  const isConnectBusy = cloudflareActionPending === "connect";
  const isRetryBusy = cloudflareActionPending === "retry";
  const isSkipBusy = cloudflareActionPending === "skip";
  const relayReady = streamHealth?.relayPathReady ? "Ready" : "Pending";
  const listeners = String(streamHealth?.listenerCount ?? 0);
  const errorMessage = cloudflareActionError ?? settingsError;
  const hasHostname = serverConfig.cloudflareHostname.trim().length > 0;
  const canConnect = isNamed ? hasHostname : true;
  const dnsJustProvisioned = cloudflare?.dnsJustProvisioned === true && cloudflareStatus === "ready";

  // Show cloudflare message, or fall through to settings status (suppress the initial placeholder).
  const statusMessage =
    cloudflareMessage ?? (settingsStatus !== "Waiting for runtime state." ? settingsStatus : null);

  return (
    <div className="grid h-full grid-cols-2 gap-2">
      {/* Left: Cloudflare Controls */}
      <div className="flex flex-col gap-1 rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))] p-2">
        <p className="shrink-0 text-[9px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--theme-muted))]">
          Cloudflare
        </p>

        <div className="flex shrink-0 overflow-hidden rounded-sm border border-[hsl(var(--theme-border))]">
          {(["temporary", "named"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => { onSettingsFieldChange("cloudflareMode", mode); }}
              className={[
                "flex-1 h-6 text-[9px] font-semibold transition-colors",
                serverConfig.cloudflareMode === mode
                  ? "bg-[hsl(var(--theme-primary))] text-white"
                  : "bg-[hsl(var(--theme-surface-alt))]",
              ].join(" ")}
            >
              {mode === "temporary" ? "Temp URL" : "Custom Domain"}
            </button>
          ))}
        </div>

        {isNamed ? (
          <NamedTunnelFields
            serverConfig={serverConfig}
            hasBusyAction={hasBusyAction}
            isProvisioning={isProvisioning}
            cloudflareStatus={cloudflareStatus}
            showRetry={showRetry}
            canConnect={canConnect}
            isConnectBusy={isConnectBusy}
            isSkipBusy={isSkipBusy}
            isRetryBusy={isRetryBusy}
            onSettingsFieldChange={onSettingsFieldChange}
            onSaveAndConnect={onSaveAndConnect}
            onSkipCloudflareForNow={onSkipCloudflareForNow}
            onRetryCloudflareSetup={onRetryCloudflareSetup}
          />
        ) : (
          <TempUrlFields
            hasBusyAction={hasBusyAction}
            isProvisioning={isProvisioning}
            cloudflareStatus={cloudflareStatus}
            showRetry={showRetry}
            isConnectBusy={isConnectBusy}
            isSkipBusy={isSkipBusy}
            isRetryBusy={isRetryBusy}
            onSaveAndConnect={onSaveAndConnect}
            onSkipCloudflareForNow={onSkipCloudflareForNow}
            onRetryCloudflareSetup={onRetryCloudflareSetup}
          />
        )}

        {statusMessage ? (
          <div className="shrink-0 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-1.5 py-1 text-[9px] leading-4 text-[hsl(var(--theme-muted))]">
            {statusMessage}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="shrink-0 rounded-sm border border-red-500/50 bg-red-500/10 px-1.5 py-1 text-[9px] leading-4 text-red-600 dark:text-red-300">
            {errorMessage}
          </div>
        ) : null}
      </div>

      {/* Right: Status + Stream */}
      <div className="flex flex-col gap-1.5 rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))] p-2">
        <p className="shrink-0 text-[9px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--theme-muted))]">
          Status
        </p>

        <div className="grid grid-cols-2 gap-1">
          <StatusTile label="Runtime" value={runtimePhase.toLowerCase()} />
          <StatusTile label="Cloudflare" value={stageLabel.toLowerCase()} />
          <StatusTile label="Relay" value={relayReady.toLowerCase()} />
          <StatusTile label="Listeners" value={listeners.toLowerCase()} />
        </div>

        <p className="shrink-0 text-[9px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--theme-muted))]">
          Stream
        </p>

        <UrlRow
          label="MP3"
          value={streamUrl}
          canCopy={mp3Enabled}
          onCopy={() => { if (mp3Enabled) void navigator.clipboard.writeText(streamUrl); }}
        />
        <UrlRow
          label="HLS"
          value={hlsUrl}
          onCopy={() => { void navigator.clipboard.writeText(hlsUrl); }}
        />

        {dnsJustProvisioned ? (
          <div className="shrink-0 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-1 text-[9px] leading-4 text-amber-700 dark:text-amber-300">
            Tunnel ready — DNS may take 1–2 min to propagate globally.
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-1">
          <div className="flex flex-col">
          <ActionButton
            disabled={!mp3Enabled}
            onClick={() => { if (mp3Enabled) void nlOs.open(streamUrl); }}
          >
            Open MP3
          </ActionButton>
          <span hidden={mp3Enabled} className="text-[60%] mt-2 mx-auto">Want to enable MP3?
          <a onClick={() => { void nlOs.open('https://www.gyan.dev/ffmpeg/builds/ffmpeg-git-essentials.7z') }} className="underline" href="https://ffmpeg.org/download.html" target="_blank" rel="noopener noreferrer"> Install FFMPEG,</a> </span>
          </div>
          <ActionButton onClick={() => { void nlOs.open(hlsUrl); }}>
            Open HLS
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components for the two Cloudflare modes
// ---------------------------------------------------------------------------

interface NamedTunnelFieldsProps {
  serverConfig: ServerConfig;
  hasBusyAction: boolean;
  isProvisioning: boolean;
  cloudflareStatus: string;
  showRetry: boolean;
  canConnect: boolean;
  isConnectBusy: boolean;
  isSkipBusy: boolean;
  isRetryBusy: boolean;
  onSettingsFieldChange: (field: keyof ServerConfig, value: string | boolean) => void;
  onSaveAndConnect: () => void;
  onSkipCloudflareForNow: () => void;
  onRetryCloudflareSetup: () => void;
}

function NamedTunnelFields({
  serverConfig,
  hasBusyAction,
  isProvisioning,
  cloudflareStatus,
  showRetry,
  canConnect,
  isConnectBusy,
  isSkipBusy,
  isRetryBusy,
  onSettingsFieldChange,
  onSaveAndConnect,
  onSkipCloudflareForNow,
  onRetryCloudflareSetup,
}: Readonly<NamedTunnelFieldsProps>) {
  return (
    <>
      <label className="shrink-0 grid gap-0.5">
        <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-[hsl(var(--theme-muted))]">
          Hostname
        </span>
        <input
          type="text"
          value={serverConfig.cloudflareHostname}
          placeholder="e.g. stream.yourdomain.com"
          onChange={(e) => { onSettingsFieldChange("cloudflareHostname", e.target.value); }}
          className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-white px-1.5 text-[10px] leading-4 outline-none focus:border-[hsl(var(--theme-primary))] dark:bg-[hsl(var(--theme-surface))]"
        />
      </label>

      <label className="shrink-0 grid gap-0.5">
        <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-[hsl(var(--theme-muted))]">
          Tunnel Name
        </span>
        <input
          type="text"
          value={serverConfig.cloudflareTunnelName}
          onChange={(e) => { onSettingsFieldChange("cloudflareTunnelName", e.target.value); }}
          className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-white px-1.5 text-[10px] leading-4 outline-none focus:border-[hsl(var(--theme-primary))] dark:bg-[hsl(var(--theme-surface))]"
        />
      </label>

      <p className="shrink-0 text-[8px] leading-4 text-[hsl(var(--theme-muted))]">
        Clicking Connect will open Cloudflare authorization in your browser — no API token required.
      </p>

      <div className="shrink-0 grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={onSaveAndConnect}
          disabled={hasBusyAction || isProvisioning || !canConnect}
          className="col-span-2 h-7 rounded-sm border border-[hsl(var(--theme-primary))] bg-[hsl(var(--theme-primary))] text-[9px] font-semibold text-white disabled:opacity-60"
        >
          {isConnectBusy ? "Connecting…" : "Save & Connect"}
        </button>
        <button
          type="button"
          onClick={onSkipCloudflareForNow}
          disabled={hasBusyAction || isProvisioning || cloudflareStatus === "ready"}
          className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[9px] font-semibold disabled:opacity-60"
        >
          {isSkipBusy ? "Skipping…" : "Skip"}
        </button>
        <button
          type="button"
          onClick={onRetryCloudflareSetup}
          disabled={hasBusyAction || isProvisioning || !showRetry}
          className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[9px] font-semibold disabled:opacity-40"
        >
          {isRetryBusy ? "Retrying…" : "Retry"}
        </button>
      </div>
    </>
  );
}

interface TempUrlFieldsProps {
  hasBusyAction: boolean;
  isProvisioning: boolean;
  cloudflareStatus: string;
  showRetry: boolean;
  isConnectBusy: boolean;
  isSkipBusy: boolean;
  isRetryBusy: boolean;
  onSaveAndConnect: () => void;
  onSkipCloudflareForNow: () => void;
  onRetryCloudflareSetup: () => void;
}

function TempUrlFields({
  hasBusyAction,
  isProvisioning,
  cloudflareStatus,
  showRetry,
  isConnectBusy,
  isSkipBusy,
  isRetryBusy,
  onSaveAndConnect,
  onSkipCloudflareForNow,
  onRetryCloudflareSetup,
}: Readonly<TempUrlFieldsProps>) {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onSaveAndConnect}
        disabled={hasBusyAction || isProvisioning}
        className="h-7 rounded-sm border border-[hsl(var(--theme-primary))] bg-[hsl(var(--theme-primary))] text-[9px] font-semibold text-white disabled:opacity-60"
      >
        {isConnectBusy ? "Connecting…" : "Start Temp URL"}
      </button>
      <button
        type="button"
        onClick={onSkipCloudflareForNow}
        disabled={hasBusyAction || isProvisioning || cloudflareStatus === "ready"}
        className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[9px] font-semibold disabled:opacity-60"
      >
        {isSkipBusy ? "Skipping…" : "Skip for Now"}
      </button>
      {showRetry ? (
        <button
          type="button"
          onClick={onRetryCloudflareSetup}
          disabled={hasBusyAction || isProvisioning}
          className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[9px] font-semibold disabled:opacity-40"
        >
          {isRetryBusy ? "Retrying…" : "Retry"}
        </button>
      ) : null}
    </div>
  );
}
