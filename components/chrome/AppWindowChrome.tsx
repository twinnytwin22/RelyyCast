"use client";

import { useWindowChrome } from "@/hooks/useWindowChrome";
import { Moon, Sun } from "lucide-react";

type AppWindowChromeProps = {
  appName: string;
  subtitle: string;
  darkMode: boolean;
  currentTimeLabel: string;
  currentDateLabel: string;
  statusLabel: string;
  onToggleDarkMode: () => void;
};

export default function AppWindowChrome({
  appName,
  subtitle,
  darkMode,
  currentTimeLabel,
  currentDateLabel,
  statusLabel,
  onToggleDarkMode,
}: Readonly<AppWindowChromeProps>) {
  const { canControlWindow, platform, windowState, minimize, toggleMaximize, close } = useWindowChrome();
  const isMac = platform === "darwin";
  const showCustomWindowControls = canControlWindow && !isMac;

  return (
    <header className="[-webkit-app-region:drag] flex items-center justify-between gap-2 border-b border-[hsl(var(--theme-border))] px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <div aria-hidden className="w-18 shrink-0" />

        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[10px] font-black tracking-[0.2em] text-[hsl(var(--theme-primary))]">
          RC
        </div>
        <div className="min-w-0">
          <p className="truncate text-[9px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--theme-muted))]">
            {subtitle}
          </p>
          <h1 className="truncate text-xs font-semibold leading-4">{appName}</h1>
        </div>
      </div>

      <div className="[-webkit-app-region:no-drag] flex items-center gap-1.5">


        <span suppressHydrationWarning className="rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--theme-muted))]">
          {currentTimeLabel}
        </span>

        <button
          type="button"
          onClick={onToggleDarkMode}
          title="Toggle light and dark mode"
          className="inline-flex h-7 items-center justify-center rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2.5 text-[10px] font-semibold transition-colors hover:bg-white/70 dark:hover:bg-white/5"
        >
          {darkMode ? <Sun className="w-3 h-3"/> : <Moon className="w-3 h-3"/>}
        </button>

        {showCustomWindowControls ? (
          <div className="flex items-center gap-1">
            <WindowButton title="Minimize" onClick={minimize}>
              -
            </WindowButton>
            <WindowButton
              title={windowState.isMaximized ? "Restore" : "Maximize"}
              onClick={toggleMaximize}
              disabled
            >
              {windowState.isMaximized ? "[]" : "+"}
            </WindowButton>
            <WindowButton title="Close" onClick={close}>
              x
            </WindowButton>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function WindowButton({
  title,
  onClick,
  children,
  disabled = false,
}: Readonly<{
  title: string;
  onClick: () => void | Promise<void>;
  children: React.ReactNode;
  disabled?: boolean;
}>) {
  return (
    <button
      type="button"
      title={title}
      onClick={() => {
        void onClick();
      }}
      disabled={disabled}
      className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[10px] font-black uppercase transition-colors hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5"
    >
      {children}
    </button>
  );
}
