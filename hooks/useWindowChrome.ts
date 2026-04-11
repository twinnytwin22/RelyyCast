"use client";

import { useEffect, useMemo, useState } from "react";
import type { WindowState } from "@/lib/platform/electron";

const DEFAULT_STATE: WindowState = {
  isMaximized: false,
  isMinimized: false,
  isFullScreen: false,
};

export function useWindowChrome() {
  const [windowState, setWindowState] = useState<WindowState>(DEFAULT_STATE);

  const api = useMemo(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    return window.electronAPI;
  }, []);

  useEffect(() => {
    if (!api) {
      return;
    }

    let alive = true;

    api.getWindowState().then((state) => {
      if (alive) {
        setWindowState(state);
      }
    });

    const unsubscribe = api.onWindowStateChange((state) => {
      setWindowState(state);
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [api]);

  return {
    platform: api?.platform,
    windowState,
    canControlWindow: Boolean(api),
    minimize: async () => {
      if (!api) {
        return;
      }
      await api.minimize();
    },
    toggleMaximize: async () => {
      if (!api) {
        return;
      }
      await api.toggleMaximize();
    },
    close: async () => {
      if (!api) {
        return;
      }
      await api.close();
    },
  };
}
