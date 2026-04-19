import { os } from "@neutralinojs/lib";
import { ensureCloudflareOnboarding } from "../cloudflared-onboarding";
import {
  DEFAULT_RELAY_RTMP_ORIGIN,
  type ManagedProcessName,
  type ProcessLaunch,
  type RuntimeConfig,
  type RuntimeState,
  type StartManagedProcessOptions,
} from "./runtime-types";
import {
  normalizeExecutablePath,
  normalizeRelayPath,
} from "./runtime-state";
import {
  deriveRuntimeRoots,
  findFirstExisting,
  getPlatformName,
  isWindows,
  joinPath,
} from "./runtime-platform";

type ResolveLaunchContext = {
  runtimeAppDataDirectory: string;
  getCurrentCloudflareState: () => RuntimeState["cloudflare"] | null;
  applyCloudflareOnboardingState: (state: RuntimeState["cloudflare"]) => void;
};

function parseFirstExecutablePath(output: string) {
  const lines = output.split(/\r?\n/g);
  for (const line of lines) {
    const normalized = normalizeExecutablePath(line);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

async function resolveExecutableOnPath(binaryName: string) {
  const command = isWindows() ? `where ${binaryName}` : `which ${binaryName}`;
  try {
    const result = await os.execCommand(command);
    if (result.exitCode !== 0) {
      return "";
    }
    return parseFirstExecutablePath(result.stdOut ?? "");
  } catch {
    return "";
  }
}

async function resolveMediatxPath(config: RuntimeConfig) {
  const explicitPath = normalizeExecutablePath(config.mediamtxPath);
  if (explicitPath) {
    return explicitPath;
  }

  const roots = deriveRuntimeRoots();
  const platformName = getPlatformName();
  const platformFolder = platformName === "darwin" ? "mac" : platformName === "windows" ? "win" : "linux";
  const candidates = isWindows()
    ? roots.flatMap((root) => [
      joinPath(root, "build", "mediamtx", "win", "mediamtx.exe"),
      joinPath(root, "binaries", "mediamtx", "win", "mediamtx.exe"),
      joinPath(root, "mediamtx", "win", "mediamtx.exe"),
    ])
    : roots.flatMap((root) => [
      joinPath(root, "build", "mediamtx", platformFolder, "mediamtx"),
      joinPath(root, "binaries", "mediamtx", platformFolder, "mediamtx"),
      joinPath(root, "mediamtx", platformFolder, "mediamtx"),
      joinPath(root, "build", "bin", "mediamtx"),
      joinPath(root, "bin", "mediamtx"),
    ]);

  const detected = await findFirstExisting(candidates);
  if (detected) {
    return detected;
  }

  return isWindows() ? "mediamtx.exe" : "mediamtx";
}

async function resolveMediatxConfigPath(config: RuntimeConfig) {
  const explicitPath = normalizeExecutablePath(config.mediamtxConfigPath);
  if (explicitPath) {
    return explicitPath;
  }

  const roots = deriveRuntimeRoots();
  const candidates = roots.flatMap((root) => [
    joinPath(root, "build", "mediamtx", "mediamtx.yml"),
    joinPath(root, "binaries", "mediamtx", "mediamtx.yml"),
    joinPath(root, "mediamtx", "mediamtx.yml"),
    joinPath(root, "server", "mediamtx.yml"),
  ]);

  const detected = await findFirstExisting(candidates);
  return detected ?? "";
}

async function resolveFfmpegPath(config: RuntimeConfig) {
  const explicitPath = normalizeExecutablePath(config.ffmpegPath);
  if (explicitPath) {
    return explicitPath;
  }

  const envs = await os.getEnvs().catch(() => ({} as Record<string, string>));
  const envOverrides = [
    normalizeExecutablePath(envs.RELYY_SERVER_FFMPEG_PATH),
    normalizeExecutablePath(envs.FFMPEG_BIN),
    normalizeExecutablePath(envs.RELYY_RADIO_FFMPEG_PATH),
  ];
  const envFfmpegPath = envOverrides.find((value) => Boolean(value));
  if (envFfmpegPath) {
    return envFfmpegPath;
  }

  const detectedOnPath = await resolveExecutableOnPath("ffmpeg");
  if (detectedOnPath) {
    return detectedOnPath;
  }

  const roots = deriveRuntimeRoots();
  const candidates = isWindows()
    ? [
      ...roots.map((root) => joinPath(root, "bin", "ffmpeg.exe")),
      "C:/ffmpeg/bin/ffmpeg.exe",
      "C:/ffmpeg/ffmpeg.exe",
      "C:/ProgramData/chocolatey/bin/ffmpeg.exe",
    ]
    : [
      ...roots.map((root) => joinPath(root, "bin", "ffmpeg")),
      "/usr/local/bin/ffmpeg",
      "/opt/homebrew/bin/ffmpeg",
      "/usr/bin/ffmpeg",
    ];

  const detected = await findFirstExisting(candidates);
  if (detected) {
    return detected;
  }

  return "";
}

function parseHttpInputUrl(config: RuntimeConfig) {
  const source = config.inputUrl.trim();
  if (!source) {
    return null;
  }
  try {
    const parsed = new URL(source);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function getRelayEndpoints(config: RuntimeConfig) {
  const relayPath = normalizeRelayPath(config.relayPath);
  const rtmpBase = (config.relayRtmpOrigin || DEFAULT_RELAY_RTMP_ORIGIN).replace(/\/+$/g, "");
  return {
    relayPath,
    rtmpUrl: `${rtmpBase}/${relayPath}`,
  };
}

function getCloudflareOriginUrl(config: RuntimeConfig) {
  if (!config.mp3Enabled) {
    return "http://127.0.0.1:8888";
  }

  const inputUrl = parseHttpInputUrl(config);
  if (inputUrl) {
    return inputUrl.origin;
  }

  // If MP3 is enabled but input is not HTTP(S), keep Cloudflare alive by routing to HLS origin.
  return "http://127.0.0.1:8888";
}

function getCloudflareMp3Path(config: RuntimeConfig) {
  const inputUrl = parseHttpInputUrl(config);
  if (!inputUrl) {
    return "/live.mp3";
  }
  const pathname = inputUrl.pathname || "/";
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function getFfmpegReconnectArgs(inputUrl: string) {
  const source = inputUrl.trim().toLowerCase();
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "2"];
  }
  return [];
}

function buildIngestFfmpegArgs(config: RuntimeConfig, rtmpPublishUrl: string) {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    ...getFfmpegReconnectArgs(config.inputUrl),
    "-i",
    config.inputUrl,
    "-vn",
    "-ac",
    config.channels,
    "-ar",
    config.sampleRate,
    "-c:a",
    "aac",
    "-b:a",
    config.bitrate,
    "-f",
    "flv",
    rtmpPublishUrl,
  ];
}

export async function buildLaunchForProcess(
  name: ManagedProcessName,
  config: RuntimeConfig,
  context: ResolveLaunchContext,
  options?: StartManagedProcessOptions,
): Promise<ProcessLaunch | null> {
  if (name === "cloudflared") {
    const trigger = options?.cloudflareTrigger ?? "auto";
    const onboarding = await ensureCloudflareOnboarding({
      appDataDirectory: context.runtimeAppDataDirectory,
      runtimeRoots: deriveRuntimeRoots(),
      cloudflaredPath: config.cloudflaredPath,
      cloudflareMode: config.cloudflareMode,
      cloudflareTunnelName: config.cloudflareTunnelName,
      cloudflareHostname: config.cloudflareHostname,
      cloudflareConfigPath: config.cloudflareConfigPath,
      originUrl: getCloudflareOriginUrl(config),
      mp3Path: config.mp3Enabled ? getCloudflareMp3Path(config) : "",
      hlsOriginUrl: "http://127.0.0.1:8888",
      hlsRelayPath: normalizeRelayPath(config.relayPath),
      trigger,
      previousState: context.getCurrentCloudflareState(),
    });

    context.applyCloudflareOnboardingState(onboarding.state);

    if (!onboarding.launch) {
      return null;
    }

    return {
      executable: onboarding.launch.executable,
      args: onboarding.launch.args,
    };
  }

  if (name === "mediamtx") {
    const executable = await resolveMediatxPath(config);
    const configPath = await resolveMediatxConfigPath(config);
    return {
      executable,
      args: configPath ? [configPath] : [],
    };
  }

  const ffmpegPath = await resolveFfmpegPath(config);
  if (!ffmpegPath) {
    return null;
  }
  const relayEndpoints = getRelayEndpoints(config);

  if (name === "ffmpegIngest") {
    return {
      executable: ffmpegPath,
      args: buildIngestFfmpegArgs(config, relayEndpoints.rtmpUrl),
    };
  }

  return null;
}
