type NeutralinoWindowSizeOptions = {
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  resizable?: boolean;
};

type NeutralinoWindowApi = {
  beginDrag: () => Promise<void>;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  unmaximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  exitFullScreen: () => Promise<void>;
  setBorderless: (borderless?: boolean) => Promise<void>;
  setSize: (options: NeutralinoWindowSizeOptions) => Promise<void>;
  setDraggableRegion: (
    domId: string | HTMLElement,
    options?: { exclusions?: Array<string | HTMLElement> },
  ) => Promise<unknown>;
  unsetDraggableRegion: (domId: string | HTMLElement) => Promise<void>;
};

type NeutralinoAppApi = {
  exit: () => Promise<void>;
};

type NeutralinoApi = {
  init?: () => void;
  window: NeutralinoWindowApi;
  app: NeutralinoAppApi;
};

declare global {
  interface Window {
    Neutralino?: NeutralinoApi;
  }
}

export {};
