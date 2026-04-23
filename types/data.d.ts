type TabId = "control" | "settings";

type ServerConfig = {
  mp3Enabled: boolean;
  inputUrl: string;
  stationName: string;
  genre: string;
  description: string;
  bitrate: string;
  ffmpegPath: string;
  relayPath: string;
  mediamtxPath: string;
  mediamtxConfigPath: string;
  cloudflareMode: CloudflareMode;
  cloudflareHostname: string;
  cloudflareTunnelName: string;
  updatesAutoEnabled: boolean;
};

type ProcessRuntime = {
  running: boolean;
  lastError: string | null;
};

type StreamHealth = {
  listenerCount: number;
  relayPathReady: boolean;
  hlsUrl: string;
  relayBytesReceived: number;
  relay: ProcessRuntime;
  ingest: ProcessRuntime;
};

type RelayMetrics = {
  listenerCount: number;
  relayPathReady: boolean;
  relayBytesReceived: number;
  mp3ListenerCount: number;
  hlsListenerCount: number;
};

type Mp3HealthListenerSnapshot = {
  listenerCount: number;
  hasEncoderHealthShape: boolean;
};

type MediaMtxPathPayload = {
  ready: boolean;
  bytesReceived: number;
  listenerCount: number;
};

