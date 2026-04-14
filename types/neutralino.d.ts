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

type NeutralinoSpawnedProcess = {
  id: number;
  pid: number;
};

type NeutralinoOsApi = {
  getPath: (name: string) => Promise<string>;
  getEnvs: () => Promise<Record<string, string>>;
  execCommand: (
    command: string,
    options?: { stdIn?: string; background?: boolean; cwd?: string },
  ) => Promise<{ pid: number; stdOut: string; stdErr: string; exitCode: number }>;
  open: (url: string) => Promise<void>;
  spawnProcess: (
    command: string,
    options?: { cwd?: string; envs?: Record<string, string> },
  ) => Promise<NeutralinoSpawnedProcess>;
  getSpawnedProcesses: () => Promise<NeutralinoSpawnedProcess[]>;
  updateSpawnedProcess: (
    id: number,
    event: string,
    data?: unknown,
  ) => Promise<void>;
};

type NeutralinoFilesystemStats = {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
};

type NeutralinoFilesystemApi = {
  createDirectory: (path: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  getStats: (path: string) => Promise<NeutralinoFilesystemStats>;
};

type NeutralinoEventsApi = {
  on: (
    event: string,
    handler: (event: CustomEvent<unknown>) => void,
  ) => Promise<{ success: boolean; message: string }>;
};

type NeutralinoApi = {
  init?: () => void;
  window: NeutralinoWindowApi;
  app: NeutralinoAppApi;
  os?: NeutralinoOsApi;
  filesystem?: NeutralinoFilesystemApi;
  events?: NeutralinoEventsApi;
};

declare global {
  interface Window {
    Neutralino?: NeutralinoApi;
    NL_MODE?: string;
    NL_PORT?: number | string;
    NL_TOKEN?: string;
    NL_PATH?: string;
    NL_CWD?: string;
    NL_OS?: string;
    NL_ARCH?: string;
    NL_CVERSION?: string;
    __nlReady?: boolean;
    __relyyRuntimeState?: unknown;
  }
}

export {};
