import { os } from "@neutralinojs/lib";
import { ensureCloudflareOnboarding } from "../cloudflared-onboarding";
import {
  DEFAULT_MP3_HELPER_PORT,
  DEFAULT_RELAY_RTMP_ORIGIN,
  type ManagedProcessName,
  type ProcessLaunch,
  type RuntimeConfig,
  type RuntimeState,
  type StartManagedProcessOptions,
} from "./runtime-types";
import {
  normalizeExecutablePath,
  normalizePort,
  normalizeRelayPath,
  sanitizeText,
} from "./runtime-state";
import {
  deriveRuntimeRoots,
  findFirstExisting,
  getArchName,
  getPlatformName,
  isWindows,
  joinPath,
} from "./runtime-platform";

type ResolveLaunchContext = {
  runtimeAppDataDirectory: string;
  getCurrentCloudflareState: () => RuntimeState["cloudflare"] | null;
  applyCloudflareOnboardingState: (state: RuntimeState["cloudflare"]) => void;
};

async function resolveBunExecutable() {
  const envs = await os.getEnvs().catch(() => ({} as Record<string, string>));
  const candidates: string[] = [];
  const configured = typeof envs.BUN_BIN === "string" ? envs.BUN_BIN.trim() : "";
  if (configured) {
    candidates.push(configured);
  }

  if (isWindows()) {
    const userProfile = typeof envs.USERPROFILE === "string" ? envs.USERPROFILE.trim() : "";
    if (userProfile) {
      candidates.push(joinPath(userProfile, ".bun", "bin", "bun.exe"));
      candidates.push(
        joinPath(
          userProfile,
          "AppData",
          "Local",
          "Microsoft",
          "WinGet",
          "Packages",
          "Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe",
          "bun-windows-x64",
          "bun.exe",
        ),
      );
    }
    const detected = await findFirstExisting(candidates);
    return detected ?? "bun";
  }

  const home = typeof envs.HOME === "string" ? envs.HOME.trim() : "";
  if (home) {
    candidates.push(joinPath(home, ".bun", "bin", "bun"));
  }
  candidates.push("/opt/homebrew/bin/bun");
  candidates.push("/usr/local/bin/bun");

  return await findFirstExisting(candidates);
}

async function resolveMediatxPath(config: RuntimeConfig) {
  const explicitPath = normalizeExecutablePath(config.mediamtxPath);
  if (explicitPath) {
    return explicitPath;
  }

  const roots = deriveRuntimeRoots();
  const platform = getPlatformName();
  const candidates = isWindows()
    ? roots.flatMap((root) => [
      joinPath(root, "build", "mediamtx", "win", "mediamtx.exe"),
      joinPath(root, "mediamtx", "win", "mediamtx.exe"),
    ])
    : roots.flatMap((root) => [
      joinPath(root, "build", "mediamtx", platform === "darwin" ? "mac" : "linux", "mediamtx"),
      joinPath(root, "mediamtx", platform === "darwin" ? "mac" : "linux", "mediamtx"),
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

  return isWindows() ? "ffmpeg.exe" : "ffmpeg";
}

async function resolveMp3HelperLaunch(config: RuntimeConfig): Promise<ProcessLaunch | null> {
  const helperArgs = [
    "--host",
    config.mp3HelperHost,
    "--port",
    String(config.mp3HelperPort),
    "--mount",
    config.mp3MountPath,
    "--station-name",
    config.stationName,
    "--station-genre",
    config.genre,
    "--station-description",
    config.description,
  ];
  const explicitPath = normalizeExecutablePath(config.mp3HelperPath);
  if (explicitPath) {
    return {
      executable: explicitPath,
      args: helperArgs,
    };
  }

  const roots = deriveRuntimeRoots();
  const platform = getPlatformName();
  const arch = getArchName();
  const helperBinaryName = isWindows() ? "relyy-mp3-helper.exe" : "relyy-mp3-helper";
  const platformTarget =
    platform === "windows"
      ? `bun-windows-${arch}-modern`
      : platform === "darwin"
        ? `bun-darwin-${arch}`
        : `bun-linux-${arch}-modern`;

  const binaryCandidates = roots.flatMap((root) => [
    joinPath(root, "build", "bin", helperBinaryName),
    joinPath(root, "runtime", "bun-mp3-helper", "dist", "host", helperBinaryName),
    joinPath(root, "runtime", "bun-mp3-helper", "dist", platformTarget, helperBinaryName),
    joinPath(root, "runtime", "bun-mp3-helper", "dist", `${platform}-${arch}`, helperBinaryName),
  ]);

  const detectedBinary = await findFirstExisting(binaryCandidates);
  const scriptCandidates = roots.map((root) => joinPath(root, "runtime", "bun-mp3-helper", "src", "main.ts"));
  const detectedScript = await findFirstExisting(scriptCandidates);
  if (detectedScript) {
    const bunExecutable = await resolveBunExecutable();
    if (bunExecutable) {
      return {
        executable: bunExecutable,
        args: ["run", detectedScript, ...helperArgs],
      };
    }
  }

  if (detectedBinary) {
    return {
      executable: detectedBinary,
      args: helperArgs,
    };
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
  const host = sanitizeText(config.mp3HelperHost, 120) || "127.0.0.1";
  const port = normalizePort(config.mp3HelperPort, DEFAULT_MP3_HELPER_PORT);
  return `http://${host}:${port}`;
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

function buildMp3BridgeFfmpegArgs(config: RuntimeConfig, rtmpReadUrl: string) {
  const sourceUrl = `http://${config.mp3HelperHost}:${config.mp3HelperPort}${config.mp3MountPath}`;
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-i",
    rtmpReadUrl,
    "-vn",
    "-ac",
    config.channels,
    "-ar",
    config.sampleRate,
    "-c:a",
    "libmp3lame",
    "-b:a",
    config.bitrate,
    "-f",
    "mp3",
    "-content_type",
    "audio/mpeg",
    "-method",
    "PUT",
    sourceUrl,
  ];
}

export async function buildLaunchForProcess(
  name: ManagedProcessName,
  config: RuntimeConfig,
  context: ResolveLaunchContext,
  options?: StartManagedProcessOptions,
): Promise<ProcessLaunch | null> {
  if (name === "mp3Helper") {
    return resolveMp3HelperLaunch(config);
  }

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
  const relayEndpoints = getRelayEndpoints(config);

  if (name === "ffmpegIngest") {
    return {
      executable: ffmpegPath,
      args: buildIngestFfmpegArgs(config, relayEndpoints.rtmpUrl),
    };
  }

  return {
    executable: ffmpegPath,
    args: buildMp3BridgeFfmpegArgs(config, relayEndpoints.rtmpUrl),
  };
}
