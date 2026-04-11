"use client";

import { useEffect, useState } from "react";
import AppStatusFooter from "@/components/chrome/AppStatusFooter";
import AppWindowChrome from "@/components/chrome/AppWindowChrome";

type TabId = "overview" | "stream" | "agent" | "domain" | "log" | any;

const tabs: Array<{ id: TabId; label: string; tip: string }> = [
  {
    id: "overview",
    label: "Overview",
    tip: "The quick station summary and current live state.",
  },
  {
    id: "stream",
    label: "Stream",
    tip: "Public MP3 URL and playback helpers.",
  },
  {
    id: "agent",
    label: "Agent",
    tip: "Desktop pairing and heartbeat status.",
  },
  {
    id: "domain",
    label: "Domain",
    tip: "Hostname status and the paid custom-domain gate.",
  },
  {
    id: "log",
    label: "Log",
    tip: "Recent operator events and state changes.",
  },
];

const stats = [
  { label: "Public URL", value: "https://wxyz.stream.relyycast.com/live.mp3" },
  { label: "Default host", value: "wxyz.stream.relyycast.com" },
  { label: "Input", value: "BlackHole 2ch" },
  { label: "Bitrate", value: "128 kbps stereo" },
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

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

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
          {/* <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--theme-border))] px-2.5 py-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <ActionButton tip="Copy the sample stream URL." size="sm">
                Copy URL
              </ActionButton>
              <ActionButton tip="Preview the stream in a player." size="sm">
                Test stream
              </ActionButton>
              <ActionButton tip="Pair the desktop agent after login." size="sm">
                Pair agent
              </ActionButton>
            </div>
          </div> */}

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

          <div className="grid gap-2.5 p-2.5 lg:grid-cols-[1fr_485px]">
            <section className="space-y-2.5">
              <Panel
                eyebrow={tabMeta[activeTab].eyebrow}
                title={tabMeta[activeTab].title}
                body={tabMeta[activeTab].body}
              >
                {renderTab(activeTab)}
              </Panel>
            </section>

            <aside className="space-y-2.5">
              <Panel eyebrow="State" title="Core values" body="">
                <div className="grid gap-1.5">
                  {stats.map((item) => (
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
            { label: "Domain", value: "Default" },
          ]}
        />
      </section>
    </main>
  );
}

const tabMeta: Record<TabId, { eyebrow: string; title: string; body: string }> = {
  overview: {
    eyebrow: "Overview",
    title: "Station at a glance",
    body: "Live bridge summary.",
  },
  stream: {
    eyebrow: "Stream",
    title: "Public MP3 endpoint",
    body: "URL and playback.",
  },
  agent: {
    eyebrow: "Agent",
    title: "Desktop pairing and heartbeat",
    body: "Pairing and health.",
  },
  domain: {
    eyebrow: "Domain",
    title: "Hostname and plan gate",
    body: "Hostname and gate.",
  },
  log: {
    eyebrow: "Log",
    title: "Recent events",
    body: "Recent events.",
  },
};

function renderTab(tab: TabId) {
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
        </div>
      );
    case "stream":
      return (
        <div className="space-y-1.5">
          <ValueRow label="Public URL" value="https://wxyz.stream.relyycast.com/live.mp3" />
          <div className="grid gap-1.5 sm:grid-cols-3">
            <ActionButton tip="Copy the public MP3 URL to your clipboard.">
              Copy URL
            </ActionButton>
            <ActionButton tip="Open the URL in a new player or browser tab.">
              Open player
            </ActionButton>
            <ActionButton tip="Send a quick playback request against the live stream.">
              Test stream
            </ActionButton>
          </div>
          <div className="rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2.5 py-2 text-[12px] leading-5 text-[hsl(var(--theme-muted))]">
            The stream stays public while the encoder and tunnel run locally. If the desktop
            app stops, the station stops.
          </div>
        </div>
      );
    case "agent":
      return (
        <div className="grid gap-1.5 sm:grid-cols-2">
          <MiniMetric
            label="Pairing code"
            value="RLY-4821"
            tip="Short-lived code used to approve the desktop agent."
          />
          <MiniMetric
            label="Device"
            value="MacBook Pro"
            tip="The paired machine currently hosting the stream origin."
          />
          <MiniMetric
            label="Bitrate"
            value="128 kbps stereo"
            tip="Conservative default for day-one streaming."
          />
          <MiniMetric
            label="Permissions"
            value="Mic granted"
            tip="Microphone access is required for the selected source."
          />
        </div>
      );
    case "domain":
      return (
        <div className="space-y-1.5">
          <ValueRow label="Default hostname" value="wxyz.stream.relyycast.com" />
          <ValueRow label="Custom domain" value="Locked on free plan" />
          <ValueRow label="SSL readiness" value="Ready for default host" />
          <div className="rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2.5 py-2 text-[12px] leading-5 text-[hsl(var(--theme-muted))]">
            Custom domains stay visible in the UI, but the paid SaaS route is a later step.
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
  body: string;
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
  size = "default",
}: Readonly<{
  children: React.ReactNode;
  tip: string;
  size?: "default" | "sm";
}>) {
  const sizeClass =
    size === "sm"
      ? "h-7 px-2.5 text-[10px]"
      : "h-8 px-3 text-[11px]";

  return (
    <button
      type="button"
      title={tip}
      className={`inline-flex items-center justify-center rounded-sm border border-[hsl(var(--theme-border))] bg-white font-semibold transition-colors hover:bg-slate-50 dark:bg-[hsl(var(--theme-surface-alt))] dark:hover:bg-white/5 ${sizeClass}`}
    >
      {children}
    </button>
  );
}

