import type { ElectronAPI } from "@/lib/platform/electron";

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    relyycastDesktop?: {
      shell: string;
    };
  }
}

export {};
