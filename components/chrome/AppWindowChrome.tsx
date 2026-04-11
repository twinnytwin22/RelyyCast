"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Minimize2, Moon, Sun, X } from "lucide-react";

type DetectedPlatform = "windows" | "macos" | "linux" | "unknown";

type AppWindowChromeProps = {
  appName: string;
  subtitle: string;
  darkMode: boolean;
  currentTimeLabel: string;
  currentDateLabel: string;
  statusLabel: string;
  onToggleDarkMode: () => void;
};

function detectPlatform(): DetectedPlatform {
  if (typeof window === "undefined") {
    return "unknown";
  }

  const w = window as Window & {
    NL_OS?: unknown;
  };
  if (typeof w.NL_OS === "string") {
    const nlOs = w.NL_OS.toLowerCase();
    if (nlOs.includes("windows")) {
      return "windows";
    }
    if (nlOs.includes("darwin") || nlOs.includes("mac")) {
      return "macos";
    }
    if (nlOs.includes("linux")) {
      return "linux";
    }
  }

  const source = [
    window.navigator.platform,
    window.navigator.userAgent,
    window.navigator.appVersion,
  ]
    .join(" ")
    .toLowerCase();
  if (source.includes("win")) {
    return "windows";
  }
  if (source.includes("mac")) {
    return "macos";
  }
  if (source.includes("linux")) {
    return "linux";
  }
  return "unknown";
}

function hasNeutralinoGlobals(): boolean {
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

export default function AppWindowChrome({
  appName,
  subtitle,
  darkMode,
  currentTimeLabel,
  currentDateLabel,
  statusLabel,
  onToggleDarkMode,
}: Readonly<AppWindowChromeProps>) {
  const [neutralinoReady, setNeutralinoReady] = useState(false);
  const [platform, setPlatform] = useState<DetectedPlatform>("unknown");

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);
  const neutralinoRef = useRef<Window["Neutralino"]>(undefined);
  const initCalledRef = useRef(false);
  const dragRegionRegisteredRef = useRef(false);
  const dragFallbackEnabledRef = useRef(false);

  const resolveNeutralinoRuntime = useCallback((): Window["Neutralino"] => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const runtime = window.Neutralino;
    if (runtime?.window && runtime?.app) {
      neutralinoRef.current = runtime;
      return runtime;
    }

    const cached = neutralinoRef.current;
    if (cached?.window && cached?.app) {
      return cached;
    }

    return undefined;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let active = true;
    let timer = 0;
    let waitingLogged = false;

    function connectNeutralino(): void {
      const nl = window.Neutralino;
      if (!nl?.window || !nl?.app) {
        if (!waitingLogged) {
          waitingLogged = true;
          const globalsDetected = hasNeutralinoGlobals();
          console.info(
            `[AppWindowChrome] waiting for Neutralino runtime (globals detected: ${String(globalsDetected)}).`,
          );
        }
        return;
      }

      neutralinoRef.current = nl;

      if (!initCalledRef.current) {
        try {
          nl.init?.();
          initCalledRef.current = true;
          console.info("[AppWindowChrome] Neutralino initialized.");
        } catch (error) {
          console.error("[AppWindowChrome] Neutralino init failed.", error);
          return;
        }
      }

      if (active) {
        setNeutralinoReady(true);
      }
      window.clearInterval(timer);
    }

    timer = window.setInterval(connectNeutralino, 250);
    connectNeutralino();

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const showWindowsControls = platform === "windows";

  useEffect(() => {
    if (!neutralinoReady) {
      return;
    }

    const runtime = resolveNeutralinoRuntime();
    if (!runtime) {
      console.error("[AppWindowChrome] Neutralino runtime unavailable during chrome setup.");
      return;
    }

    async function setupWindowChrome(activeRuntime: NonNullable<Window["Neutralino"]>) {
      console.info("[AppWindowChrome] applying window constraints and drag region.");

      try {
        await activeRuntime.window.exitFullScreen();
      } catch (error) {
        console.warn("[AppWindowChrome] exitFullScreen failed.", error);
      }

      try {
        await activeRuntime.window.setSize({
          width: 1024,
          height: 500,
          minWidth: 1024,
          minHeight: 500,
          maxWidth: 1024,
          maxHeight: 500,
          resizable: false,
        });
      } catch (error) {
        console.warn("[AppWindowChrome] setSize failed.", error);
      }

      try {
        await activeRuntime.window.setBorderless(true);
      } catch (error) {
        console.warn("[AppWindowChrome] setBorderless failed.", error);
      }

      const exclusions: Array<string | HTMLElement> = [];
      const exclusionIds = ["window-controls", "theme-toggle"];
      for (const id of exclusionIds) {
        const element = document.getElementById(id);
        if (!element) {
          console.warn(`[AppWindowChrome] drag exclusion target missing: #${id}`);
          continue;
        }
        exclusions.push(element);
      }

      for (const element of document.querySelectorAll<HTMLElement>("[data-no-drag='true']")) {
        if (!exclusions.includes(element)) {
          exclusions.push(element);
        }
      }

      try {
        await activeRuntime.window.setDraggableRegion("app-window-chrome", { exclusions });
        dragRegionRegisteredRef.current = true;
        dragFallbackEnabledRef.current = false;
        console.info(
          `[AppWindowChrome] draggable region registered (exclusions: ${exclusions.length}).`,
        );
      } catch (error) {
        dragRegionRegisteredRef.current = false;
        dragFallbackEnabledRef.current = platform === "windows" || platform === "unknown";
        console.error("[AppWindowChrome] setDraggableRegion failed.", error);
        if (dragFallbackEnabledRef.current) {
          console.warn("[AppWindowChrome] beginDrag fallback enabled.");
        }
      }
    }

    void setupWindowChrome(runtime);

    return () => {
      if (!dragRegionRegisteredRef.current) {
        return;
      }

      const runtime = resolveNeutralinoRuntime();
      if (!runtime) {
        console.warn("[AppWindowChrome] cannot unset draggable region; runtime unavailable.");
        return;
      }

      void runtime.window
        .unsetDraggableRegion("app-window-chrome")
        .then(() => {
          dragRegionRegisteredRef.current = false;
          console.info("[AppWindowChrome] draggable region removed.");
        })
        .catch((error) => {
          console.warn("[AppWindowChrome] unsetDraggableRegion failed.", error);
        });
    };
  }, [neutralinoReady, platform, resolveNeutralinoRuntime]);

  const onMinimize = useCallback(async () => {
    const nl = resolveNeutralinoRuntime();
    if (!nl) {
      console.warn("[AppWindowChrome] minimize ignored; Neutralino runtime unavailable.");
      return;
    }

    try {
      console.info("[AppWindowChrome] minimize requested.");
      await nl.window.minimize();
    } catch (error) {
      console.error("[AppWindowChrome] minimize failed.", error);
    }
  }, [resolveNeutralinoRuntime]);

  const onClose = useCallback(async () => {
    const nl = resolveNeutralinoRuntime();
    if (nl) {
      try {
        console.info("[AppWindowChrome] close requested.");
        await nl.app.exit();
        return;
      } catch (error) {
        console.error("[AppWindowChrome] close failed.", error);
      }
    }

    try {
      console.warn("[AppWindowChrome] fallback window.close() requested.");
      window.close();
    } catch (error) {
      console.error("[AppWindowChrome] window.close fallback failed.", error);
    }
  }, [resolveNeutralinoRuntime]);

  const onHeaderMouseDown = useCallback(async (event: MouseEvent<HTMLElement>) => {
    if (!neutralinoReady || !dragFallbackEnabledRef.current || event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-no-drag='true']")) {
      return;
    }

    const nl = resolveNeutralinoRuntime();
    if (!nl) {
      console.warn("[AppWindowChrome] beginDrag fallback unavailable; runtime missing.");
      return;
    }

    try {
      await nl.window.beginDrag();
    } catch (error) {
      console.error("[AppWindowChrome] beginDrag fallback failed.", error);
    }
  }, [neutralinoReady, resolveNeutralinoRuntime]);

  return (
    <header
      id="app-window-chrome"
      onMouseDown={(event) => {
        void onHeaderMouseDown(event);
      }}
      className="[-webkit-app-region:drag] flex items-center gap-2 border-b border-[hsl(var(--theme-border))] px-2.5 py-2"
    >
      <div className="flex min-w-0 items-center gap-2.5">
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

      <div className="[-webkit-app-region:no-drag] ml-auto flex items-center gap-1.5">
        <span suppressHydrationWarning className="rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--theme-muted))]">
          {currentTimeLabel}
        </span>

        <span suppressHydrationWarning className="rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--theme-muted))]">
          {currentDateLabel}
        </span>

        <span className="rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--theme-muted))]">
          {statusLabel}
        </span>

        <button
          id="theme-toggle"
          data-no-drag="true"
          type="button"
          onClick={onToggleDarkMode}
          title="Toggle light and dark mode"
          className="inline-flex h-7 items-center justify-center rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2.5 text-[10px] font-semibold transition-colors hover:bg-white/70 dark:hover:bg-white/5"
        >
          {darkMode ? <Sun className="w-3 h-3"/> : <Moon className="w-3 h-3"/>}
        </button>

        {showWindowsControls ? (
          <div id="window-controls" data-no-drag="true" className="flex items-center gap-1">
            <button
              type="button"
              data-no-drag="true"
              onClick={() => {
                void onMinimize();
              }}
              title="Minimize"
              disabled={!neutralinoReady}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[11px] font-bold transition-colors hover:bg-white/70 dark:hover:bg-white/5"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-no-drag="true"
              onClick={() => {
                void onClose();
              }}
              title="Close"
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[11px] font-bold transition-colors hover:bg-white/70 dark:hover:bg-white/5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
