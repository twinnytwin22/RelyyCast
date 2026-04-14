import { useState, type ReactNode } from "react";
import { Link2, RotateCcw, SkipForward } from "lucide-react";
import { type RuntimeState } from "@/src/runtime/neutralino-runtime-orchestrator";

type Props = {
  runtimeState: RuntimeState | null;
  publicMp3Url: string;
  helperStatusUrl: string;
  isCloudflareActionPending: "connect" | "retry" | "skip" | null;
  cloudflareActionError: string | null;
  onRequestCloudflareLogin: () => void;
  onRetryCloudflareSetup: () => void;
  onSkipCloudflareForNow: () => void;
  onOpenCloudflareSettings: () => void;
};

export default function AgentOperationsPanel({
  runtimeState,
  publicMp3Url,
  helperStatusUrl,
  isCloudflareActionPending,
  cloudflareActionError,
  onRequestCloudflareLogin,
  onRetryCloudflareSetup,
  onSkipCloudflareForNow,
  onOpenCloudflareSettings,
}: Readonly<Props>) {
  const [showConsentDialog, setShowConsentDialog] = useState(false);

  const runtimePhase = runtimeState?.phase ?? "starting";
  const cloudflareMode = runtimeState?.config.cloudflareMode ?? "temporary";
  const configuredHostname = runtimeState?.config.cloudflareHostname?.trim() ?? "";
  const usesNamedTunnel = cloudflareMode === "named";
  const requiresHostnameConfiguration = usesNamedTunnel && configuredHostname.length === 0;
  const cloudflare = runtimeState?.cloudflare ?? null;
  const publicUrl = cloudflare?.publicUrl ?? "";
  const hasPublicUrl = /^https?:\/\//i.test(publicUrl);
  const cloudflareStatus = cloudflare?.status ?? "pending-consent";
  const cloudflareHostname = cloudflare?.hostname ?? "Not configured";
  const cloudflarePublicUrl = cloudflare?.publicUrl ?? "Not available";
  const showRetry = cloudflare?.canRetry === true || cloudflare?.nextAction === "retry-cloudflare";
  const connectTitle = requiresHostnameConfiguration
    ? "Configure Cloudflare Domain"
    : cloudflareStatus === "ready"
      ? usesNamedTunnel
        ? "Reconnect Cloudflare"
        : "Refresh Temporary URL"
    : usesNamedTunnel
      ? "Connect Cloudflare"
      : "Start Temporary URL";
  const consentTitle = usesNamedTunnel ? "Consent required" : "Temporary public URL";
  const consentBody = usesNamedTunnel
    ? "Run Cloudflare login and open browser auth for your configured hostname."
    : "Start a temporary trycloudflare.com URL. No Cloudflare domain is required.";
  const confirmLabel = usesNamedTunnel ? "Continue" : "Start URL";

  const isConnectBusy = isCloudflareActionPending === "connect";
  const isRetryBusy = isCloudflareActionPending === "retry";
  const isSkipBusy = isCloudflareActionPending === "skip";
  const hasBusyAction = isCloudflareActionPending !== null;
  const isProvisioning = cloudflareStatus === "provisioning";

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-1">
        <IconActionButton
          title={isConnectBusy ? "Connecting..." : connectTitle}
          onClick={() => {
            if (requiresHostnameConfiguration) {
              onOpenCloudflareSettings();
              return;
            }
            setShowConsentDialog(true);
          }}
          disabled={hasBusyAction || isProvisioning}
          icon={<Link2 size={14} />}
        />
        <IconActionButton
          title={isSkipBusy ? "Skipping..." : "Skip Cloudflare for now"}
          onClick={onSkipCloudflareForNow}
          disabled={hasBusyAction || isProvisioning || cloudflareStatus === "ready"}
          icon={<SkipForward size={14} />}
        />
        {showRetry ? (
          <div className="col-span-2">
            <IconActionButton
              title={isRetryBusy ? "Retrying..." : "Retry Cloudflare setup"}
              onClick={onRetryCloudflareSetup}
              disabled={hasBusyAction || isProvisioning}
              icon={<RotateCcw size={14} />}
              fullWidth
            />
          </div>
        ) : null}
      </div>

      {showConsentDialog ? (
        <div className="space-y-1 rounded-sm border border-[hsl(var(--theme-primary))] bg-[hsl(var(--theme-surface-alt))] px-2 py-1.5 text-[10px] leading-4">
          <p className="font-semibold">{consentTitle}</p>
          <p className="text-[hsl(var(--theme-muted))]">{consentBody}</p>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => {
                setShowConsentDialog(false);
              }}
              className="h-7 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[10px] font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setShowConsentDialog(false);
                onRequestCloudflareLogin();
              }}
              className="h-7 rounded-sm border border-[hsl(var(--theme-primary))] bg-[hsl(var(--theme-primary))] text-[10px] font-semibold text-white"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-1">
        <StatusTile label="Runtime" value={runtimePhase.toUpperCase()} />
        <StatusTile label="Cloudflare" value={cloudflareStatus.toUpperCase()} />
        <StatusTile label="Hostname" value={cloudflareHostname} mono />
        <StatusTile label="Public URL" value={cloudflarePublicUrl} mono />
      </div>

      {cloudflare?.message ? (
        <div className="rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 py-1 text-[10px] text-[hsl(var(--theme-muted))]">
          {cloudflare.message}
        </div>
      ) : null}

      {cloudflareActionError ? (
        <div className="rounded-sm border border-red-500/50 bg-red-500/10 px-2 py-1 text-[10px] text-red-600 dark:text-red-300">
          {cloudflareActionError}
        </div>
      ) : null}

      <details className="rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 py-1">
        <summary className="cursor-pointer text-[10px] font-semibold">Details</summary>
        <div className="mt-1 space-y-1">
          <DetailRow label="Mode" value={usesNamedTunnel ? "Custom Domain" : "Temporary URL"} />
          <DetailRow label="Tunnel" value={cloudflare?.tunnelName ?? "Not set"} />
          <DetailRow label="Tunnel ID" value={cloudflare?.tunnelId ?? "Not set"} mono />
          <DetailRow label="Last Attempt" value={cloudflare?.lastAttemptAt ?? "Never"} mono />
          <div className={["gap-1 pt-1", hasPublicUrl ? "grid grid-cols-2" : "grid grid-cols-2"].join(" ")}>
            {hasPublicUrl ? (
              <>
                <button
                  type="button"
                  title="Copy Cloudflare URL"
                  onClick={() => {
                    void navigator.clipboard.writeText(publicUrl);
                  }}
                  className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))] text-[9px] font-semibold"
                >
                  Copy URL
                </button>
                <button
                  type="button"
                  title="Open Cloudflare URL"
                  onClick={() => {
                    window.open(publicUrl, "_blank", "noopener,noreferrer");
                  }}
                  className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))] text-[9px] font-semibold"
                >
                  Open URL
                </button>
              </>
            ) : null}
            <button
              type="button"
              title="Copy public MP3 URL"
              onClick={() => {
                void navigator.clipboard.writeText(publicMp3Url);
              }}
              className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))] text-[9px] font-semibold"
            >
              Copy MP3
            </button>
            <button
              type="button"
              title="Open helper status"
              onClick={() => {
                window.open(helperStatusUrl, "_blank", "noopener,noreferrer");
              }}
              className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))] text-[9px] font-semibold"
            >
              Helper
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

function StatusTile({
  label,
  value,
  mono = false,
}: Readonly<{
  label: string;
  value: string;
  mono?: boolean;
}>) {
  return (
    <div className="rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 py-1">
      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--theme-muted))]">{label}</p>
      <p className={["mt-0.5 truncate text-[10px]", mono ? "font-mono" : ""].join(" ")} title={value}>
        {value}
      </p>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: Readonly<{
  label: string;
  value: string;
  mono?: boolean;
}>) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
      <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[hsl(var(--theme-muted))]">{label}</span>
      <span className={["truncate text-right text-[10px]", mono ? "font-mono" : ""].join(" ")} title={value}>
        {value}
      </span>
    </div>
  );
}

function IconActionButton({
  title,
  onClick,
  disabled,
  icon,
  fullWidth = false,
}: Readonly<{
  title: string;
  onClick: () => void;
  disabled: boolean;
  icon: ReactNode;
  fullWidth?: boolean;
}>) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={[
        "grid h-7 place-items-center rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] disabled:opacity-60",
        fullWidth ? "w-full" : "",
      ].join(" ")}
    >
      {icon}
    </button>
  );
}
