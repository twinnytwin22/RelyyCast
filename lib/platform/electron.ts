export type WindowState = {
  isMaximized: boolean;
  isMinimized: boolean;
  isFullScreen: boolean;
};

export type WindowStateListener = (state: WindowState) => void;

export type ElectronAPI = {
  platform: NodeJS.Platform;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  getWindowState: () => Promise<WindowState>;
  onWindowStateChange: (listener: WindowStateListener) => () => void;
};
