

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { BadgeQuestionMark, CircleQuestionMark, Minimize, Minimize2, MinusIcon, Moon, Sun, X } from "lucide-react";
import {
  window as nlWindow,
  init as nlInit,
  os as nlOs,
} from "@neutralinojs/lib";
import { showTrayCloseHintOnce } from "@/src/runtime/tray-close-hint";

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

// Module-level singleton so init() is only called once across StrictMode re-mounts.
// __nlReady is set on window once the WebSocket "ready" event fires.
let _nlInitStarted = false;
const _nlReadyCallbacks: Array<() => void> = [];

function ensureNlReady(onReady: () => void): void {
  const w = window as Window & { __nlReady?: boolean };

  if (w.__nlReady) {
    onReady();
    return;
  }

  _nlReadyCallbacks.push(onReady);

  if (!_nlInitStarted) {
    _nlInitStarted = true;

    window.addEventListener("ready", function handleReady() {
      window.removeEventListener("ready", handleReady);
      w.__nlReady = true;
      const callbacks = _nlReadyCallbacks.splice(0);
      for (const cb of callbacks) {
        cb();
      }
    });

    nlInit();
  }
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
  const [showHelp, setShowHelp] = useState(false);
  const dragRegionRegisteredRef = useRef(false);
  const dragFallbackEnabledRef = useRef(false);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let active = true;
    let timer = 0;
    let waitingLogged = false;
    let connecting = false;

    function connectNeutralino(): void {
      if (!hasNeutralinoGlobals()) {
        if (!waitingLogged) {
          waitingLogged = true;
          console.info("[AppWindowChrome] waiting for Neutralino globals.");
        }
        return;
      }

      if (connecting) {
        return;
      }
      connecting = true;
      window.clearInterval(timer);

      console.info("[AppWindowChrome] Neutralino globals detected, initializing...");
      ensureNlReady(() => {
        if (active) {
          console.info("[AppWindowChrome] Neutralino ready.");
          setNeutralinoReady(true);
        }
      });
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

    async function setupWindowChrome() {
      console.info("[AppWindowChrome] applying drag region.");

      // setSize / setBorderless are already declared in neutralino.config.json and applied
      // at native startup. Re-calling them from JS triggers setStyleMask:/setFrame: on
      // macOS which resets the WKWebView first-responder slot → breaking all keyboard input.
      // 
      // Workaround: We specifically disable borderless mode on macOS because borderless
      // windows on macOS completely fail to capture keyboard focus.
      if (platform === "macos") {
        try {
          await nlWindow.setBorderless(false);
          console.info("[AppWindowChrome] disabled borderless mode for macOS.");
        } catch (error) {
          console.warn("[AppWindowChrome] setBorderless(false) fallback failed.", error);
        }
      }

      const exclude: Array<string | HTMLElement> = [];
      const exclusionIds = ["window-controls", "theme-toggle"];
      for (const id of exclusionIds) {
        const element = document.getElementById(id);
        if (!element) {
          console.warn(`[AppWindowChrome] drag exclusion target missing: #${id}`);
          continue;
        }
        exclude.push(element);
      }

      for (const element of document.querySelectorAll<HTMLElement>("[data-no-drag='true']")) {
        if (!exclude.includes(element)) {
          exclude.push(element);
        }
      }

      try {
        await nlWindow.setDraggableRegion("app-window-chrome", { exclude });
        dragRegionRegisteredRef.current = true;
        dragFallbackEnabledRef.current = false;
        console.info(
          `[AppWindowChrome] draggable region registered (exclusions: ${exclude.length}).`,
        );
      } catch (error) {
        dragRegionRegisteredRef.current = false;
        dragFallbackEnabledRef.current = platform === "windows" || platform === "unknown";
        console.error("[AppWindowChrome] setDraggableRegion failed.", error);
        if (dragFallbackEnabledRef.current) {
          console.warn("[AppWindowChrome] beginDrag fallback enabled.");
        }
      }

      // On macOS, setBorderless / setSize can cause the NSWindow to resign key-window
      // status, which silently breaks all keyboard input and input focus routing.
      // Calling focus() restores key-window status without affecting other platforms.
      try {
        await nlWindow.focus();
        console.info("[AppWindowChrome] window focus restored.");
      } catch (error) {
        console.warn("[AppWindowChrome] window.focus() failed.", error);
      }
    }

    void setupWindowChrome();

    return () => {
      if (!dragRegionRegisteredRef.current) {
        return;
      }

      void nlWindow
        .unsetDraggableRegion("app-window-chrome")
        .then(() => {
          dragRegionRegisteredRef.current = false;
          console.info("[AppWindowChrome] draggable region removed.");
        })
        .catch((error: unknown) => {
          console.warn("[AppWindowChrome] unsetDraggableRegion failed.", error);
        });
    };
  }, [neutralinoReady, platform]);

  const onMinimize = useCallback(async () => {
    if (!neutralinoReady) {
      console.warn("[AppWindowChrome] minimize ignored; Neutralino not ready.");
      return;
    }

    try {
      console.info("[AppWindowChrome] minimize requested.");
      await nlWindow.minimize();
    } catch (error) {
      console.error("[AppWindowChrome] minimize failed.", error);
    }
  }, [neutralinoReady]);

  const onClose = useCallback(async () => {
    if (neutralinoReady) {
      try {
        console.info("[AppWindowChrome] close requested; hiding to tray.");
        await nlWindow.hide();
        void showTrayCloseHintOnce();
        return;
      } catch (error) {
        console.error("[AppWindowChrome] hide-to-tray failed.", error);
      }
    }

    try {
      console.warn("[AppWindowChrome] fallback window.close() requested.");
      window.close();
    } catch (error) {
      console.error("[AppWindowChrome] window.close fallback failed.", error);
    }
  }, [neutralinoReady]);

  const onHeaderMouseDown = useCallback(async (event: MouseEvent<HTMLElement>) => {
    if (!neutralinoReady || !dragFallbackEnabledRef.current || event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-no-drag='true']")) {
      return;
    }

    try {
      await nlWindow.beginDrag();
    } catch (error) {
      console.error("[AppWindowChrome] beginDrag fallback failed.", error);
    }
  }, [neutralinoReady]);
  const handleOpenHelp = useCallback(() => {
    setShowHelp(!showHelp);
    //renderHelpMenu()
  }, [showHelp]);


  const handleOpenLink = useCallback(async ({ link }: { link: string }) => {
    console.info(`[AppWindowChrome] openLink click: ${link}`);

    let url: URL;
    try {
      url = new URL(link);
    } catch (error) {
      console.warn(`[AppWindowChrome] openLink(${link}) invalid URL.`, error);
      return;
    }

    if (!(["http:", "https:"].includes(url.protocol))) {
      console.warn(`[AppWindowChrome] openLink(${link}) blocked protocol: ${url.protocol}`);
      return;
    }

    try {
      if (neutralinoReady) {
        await nlOs.open(url.href);
        return;
      }
      console.warn(`[AppWindowChrome] openLink(${url.href}) using browser fallback; Neutralino not ready.`);
    } catch (error) {
      console.error(`[AppWindowChrome] nlOs.open(${url.href}) failed; using browser fallback.`, error);
    }

    window.open(url.href, "_blank", "noopener,noreferrer");
  }, [neutralinoReady]);

  return (
    <header
      id="app-window-chrome"
      onMouseDown={(event) => {
        void onHeaderMouseDown(event);
      }}
      className="flex items-center gap-2 border-b border-[hsl(var(--theme-border))] px-2.5 py-2 relative select-none [-webkit-app-region:drag]"
    >

      <div
        data-no-drag="true"
        aria-hidden={!showHelp}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        className={`absolute right-2 top-full mt-1 w-48 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] p-2 text-sm text-[hsl(var(--theme-muted))] shadow-lg [-webkit-app-region:no-drag] ${showHelp ? "block" : "hidden"}`}
      >
        <p className="mb-2 flex items-center gap-1">
          <BadgeQuestionMark className="w-4 h-4"/>
          Need help?
        </p>
        <ul className="space-y-1">
          <li>
            <button
              type="button"
              data-no-drag="true"
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onClick={() => handleOpenLink({ link: "https://docs.relyy.app" })}
              className="block w-full rounded-sm px-2 py-1 text-left hover:bg-white/10"
            >
              Documentation
            </button>
          </li>
          <li>
            <button
              type="button"
              data-no-drag="true"
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onClick={() => handleOpenLink({ link: "https://support.relyy.app" })}
              className="block w-full rounded-sm px-2 py-1 text-left hover:bg-white/10"
            >
              Support
            </button>
          </li>
        </ul>
      </div>
      <div className="flex min-w-0 items-center gap-2.5">
       <img src="/favicon.ico" alt="App icon" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[10px] font-black tracking-[0.2em] text-[hsl(var(--theme-primary))]" />
      
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
        <button
          id="help-button"
          data-no-drag="true"
          type="button"
          onClick={handleOpenHelp}
          title="Help / Documentation"
          className="inline-flex h-7 items-center justify-center rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2.5 text-[10px] font-semibold transition-colors hover:bg-white/70 dark:hover:bg-white/5"
        >
          <CircleQuestionMark className="w-3.5 h-3.5"/>
        </button>
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
              <MinusIcon className="h-3.5 w-3.5" />
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
