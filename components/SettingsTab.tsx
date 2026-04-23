import type { UpdateCheckState } from "@/src/runtime/neutralino-runtime-orchestrator";
import { ConfigField } from "./ConfigField";

interface SettingsTabProps {
  serverConfig: ServerConfig;
  settingsStatus: string;
  settingsError: string | null;
  isSavingSettings: boolean;
  onSettingsFieldChange: (field: keyof ServerConfig, value: string | boolean) => void;
  onSaveSettings: () => void;
  updateState: UpdateCheckState | null;
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
  onDismissUpdate: () => void;
}

function describeUpdateStatus(update: UpdateCheckState | null): string {
  if (!update || update.status === "idle") return "Not checked yet.";
  if (update.status === "checking") return "Checking for updates…";
  if (update.status === "up-to-date") {
    const when = update.lastCheckedAt
      ? ` Last checked ${new Date(update.lastCheckedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
      : "";
    return `Up to date (v${update.currentVersion ?? "?"}).${when}`;
  }
  if (update.status === "available") return `v${update.latestVersion} available. Ready to download.`;
  if (update.status === "downloading") return `Downloading v${update.latestVersion}…`;
  if (update.status === "downloaded" || update.status === "ready-to-install") {
    return `v${update.latestVersion} ready to install.`;
  }
  if (update.status === "installing") return "Launching installer…";
  if (update.status === "error") return `Error: ${update.lastError ?? "Unknown error."}`;
  return "";
}

export function SettingsTab({
  serverConfig,
  settingsStatus,
  settingsError,
  isSavingSettings,
  onSettingsFieldChange,
  onSaveSettings,
  updateState,
  onCheckForUpdates,
  onInstallUpdate,
  onDismissUpdate,
}: Readonly<SettingsTabProps>) {
  const updateStatusText = describeUpdateStatus(updateState);
  const isCheckBusy =
    updateState?.status === "checking"
    || updateState?.status === "downloading"
    || updateState?.status === "installing";
  const isReadyToInstall =
    updateState?.status === "ready-to-install" || updateState?.status === "downloaded";

  return (
    <div className="flex h-full flex-col gap-2 rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))] p-2">
      <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--theme-muted))]">
        Configuration
      </p>

      <div className="grid grid-cols-3 gap-1.5">
        {/* MP3 toggle */}
        <div className="col-span-3 flex items-center justify-between rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 py-1.5">
          <div>
            <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-[hsl(var(--theme-muted))]">
              MP3 Output
            </p>
            <p className="text-[9px] text-[hsl(var(--theme-muted))]">
              Enable after install, save settings, then restart the app.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { onSettingsFieldChange("mp3Enabled", !serverConfig.mp3Enabled); }}
            className={[
              "h-7 rounded-sm border px-2 text-[9px] font-semibold",
              serverConfig.mp3Enabled
                ? "border-[hsl(var(--theme-primary))] bg-[hsl(var(--theme-primary))] text-white"
                : "border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))]",
            ].join(" ")}
          >
            {serverConfig.mp3Enabled ? "Enabled" : "Disabled"}
          </button>
        </div>

        <div className="col-span-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onSaveSettings}
            disabled={isSavingSettings}
            className="h-7 rounded-sm border border-[hsl(var(--theme-primary))] bg-[hsl(var(--theme-primary))] px-2 text-[9px] font-semibold text-white"
          >
            {isSavingSettings ? "Saving..." : "Save Settings"}
          </button>
          <button
            type="button"
            onClick={onCheckForUpdates}
            disabled={isCheckBusy}
            className="h-7 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 text-[9px] font-semibold disabled:opacity-60"
          >
            {updateState?.status === "checking" ? "Checking..." : "Check for Updates"}
          </button>
          {isReadyToInstall && (
            <>
              <button
                type="button"
                onClick={onInstallUpdate}
                className="h-7 rounded-sm border border-[hsl(var(--theme-primary))] bg-[hsl(var(--theme-primary))] px-2 text-[9px] font-semibold text-white"
              >
                Install and Restart
              </button>
              <button
                type="button"
                onClick={onDismissUpdate}
                className="h-7 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 text-[9px] font-semibold"
              >
                Later
              </button>
            </>
          )}
        </div>

        <div className="col-span-3 grid gap-1">
          <div className="truncate rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-1.5 py-1 text-[9px] text-[hsl(var(--theme-muted))]">
            {settingsError ? `Error: ${settingsError}` : settingsStatus}
          </div>
          <div className="truncate rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-1.5 py-1 text-[9px] text-[hsl(var(--theme-muted))]">
            {updateStatusText}
          </div>
        </div>

        <ConfigField
          label="Input URL"
          value={serverConfig.inputUrl}
          onChange={(v) => { onSettingsFieldChange("inputUrl", v); }}
        />
        <ConfigField
          label="Station Name"
          value={serverConfig.stationName}
          onChange={(v) => { onSettingsFieldChange("stationName", v); }}
        />
        <ConfigField
          label="Bitrate"
          value={serverConfig.bitrate}
          onChange={(v) => { onSettingsFieldChange("bitrate", v); }}
        />
        <ConfigField
          label="Relay Path"
          value={serverConfig.relayPath}
          onChange={(v) => { onSettingsFieldChange("relayPath", v); }}
        />
        <ConfigField
          label="Genre"
          value={serverConfig.genre}
          onChange={(v) => { onSettingsFieldChange("genre", v); }}
        />
        <ConfigField
          label="Description"
          value={serverConfig.description}
          onChange={(v) => { onSettingsFieldChange("description", v); }}
        />

        {/*
          FFmpeg/MediaMTX paths are hidden until the auto-detect flow is wired up.
          The values are still persisted and sent to the runtime - just not editable here.
        */}
        <div className="hidden">
          <ConfigField
            label="FFmpeg Path"
            value={serverConfig.ffmpegPath}
            onChange={(v) => { onSettingsFieldChange("ffmpegPath", v); }}
          />
          <ConfigField
            label="MediaMTX Path"
            value={serverConfig.mediamtxPath}
            onChange={(v) => { onSettingsFieldChange("mediamtxPath", v); }}
          />
          <ConfigField
            label="MediaMTX Config"
            value={serverConfig.mediamtxConfigPath}
            onChange={(v) => { onSettingsFieldChange("mediamtxConfigPath", v); }}
          />
        </div>
      </div>
    </div>
  );
}
