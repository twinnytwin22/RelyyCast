import { filesystem, os } from "@neutralinojs/lib";

type CommandResult = {
  exitCode: number;
  stdOut: string;
  stdErr: string;
};

type TunnelListItem = {
  id: string;
  name: string;
};

type CloudflareMode = "temporary" | "named";

export type CloudflareOnboardingState = {
  status: "pending-consent" | "login-required" | "provisioning" | "ready" | "error";
  setupStage: "idle" | "creating-tunnel" | "routing-dns" | "launching" | "ready" | "failed";
  message: string | null;
  binaryPath: string | null;
  appDirectory: string | null;
  tunnelName: string | null;
  tunnelId: string | null;
  hostname: string | null;
  publicUrl: string | null;
  certPath: string | null;
  credentialsPath: string | null;
  configPath: string | null;
  loginRequired: boolean;
  dnsRouted: boolean;
  dnsJustProvisioned: boolean;
  requiresUserAction: boolean;
  nextAction: "connect-cloudflare" | "retry-cloudflare" | "skip-cloudflare" | "none";
  canRetry: boolean;
  lastUserPromptAt: string | null;
  lastAttemptAt: string | null;
  lastCheckedAt: string | null;
};

export type CloudflareLaunchConfig = {
  executable: string;
  args: string[];
};

export type EnsureCloudflareOnboardingInput = {
  appDataDirectory: string;
  runtimeRoots: string[];
  cloudflaredPath: string;
  cloudflareMode: CloudflareMode;
  cloudflareTunnelName: string;
  cloudflareHostname: string;
  cloudflareConfigPath: string;
  originUrl: string;
  trigger: "auto" | "request-login" | "retry";
  previousState?: CloudflareOnboardingState | null;
};

export type EnsureCloudflareOnboardingResult = {
  state: CloudflareOnboardingState;
  launch: CloudflareLaunchConfig | null;
};

type RuntimePlatform = "win" | "darwin" | "linux";

function getRuntimePlatform(): RuntimePlatform {
  const nlOs = String(window.NL_OS ?? "").toLowerCase();
  if (nlOs.includes("windows")) {
    return "win";
  }
  if (nlOs.includes("darwin") || nlOs.includes("mac")) {
    return "darwin";
  }
  if (nlOs.includes("linux")) {
    return "linux";
  }

  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
  if (userAgent.includes("windows")) {
    return "win";
  }
  if (userAgent.includes("mac")) {
    return "darwin";
  }
  return "linux";
}

const CLOUDFLARED_PLATFORM = getRuntimePlatform();
const CLOUDFLARED_BINARY_NAME = CLOUDFLARED_PLATFORM === "win" ? "cloudflared.exe" : "cloudflared";
const CLOUDFLARED_BINARY_CANDIDATES = CLOUDFLARED_PLATFORM === "win"
  ? ["cloudflared.exe", "cloudflared-windows-amd64.exe"]
  : CLOUDFLARED_PLATFORM === "darwin"
    ? ["cloudflared", "cloudflared-darwin-amd64", "cloudflared-darwin-arm64"]
    : ["cloudflared", "cloudflared-linux-amd64", "cloudflared-linux-arm64"];
const TUNNEL_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const QUICK_TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function nowIso() {
  return new Date().toISOString();
}

function extractQuickTunnelUrl(text: string) {
  const match = text.match(QUICK_TUNNEL_URL_PATTERN);
  return match ? match[0] : null;
}

function isQuickTunnelUrl(value: string | null | undefined) {
  return typeof value === "string" && QUICK_TUNNEL_URL_PATTERN.test(value);
}

function getHostnameFromUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function createDefaultCloudflareState(): CloudflareOnboardingState {
  return {
    status: "pending-consent",
    setupStage: "idle",
    message: null,
    binaryPath: null,
    appDirectory: null,
    tunnelName: null,
    tunnelId: null,
    hostname: null,
    publicUrl: null,
    certPath: null,
    credentialsPath: null,
    configPath: null,
    loginRequired: false,
    dnsRouted: false,
    dnsJustProvisioned: false,
    requiresUserAction: true,
    nextAction: "connect-cloudflare",
    canRetry: false,
    lastUserPromptAt: null,
    lastAttemptAt: null,
    lastCheckedAt: null,
  };
}

function normalizeExecutablePath(value: string) {
  return value.trim().replace(/^"(.*)"$/, "$1");
}

function sanitizeText(value: string, maxLength: number) {
  return value.replace(/[\r\n]/g, " ").slice(0, maxLength).trim();
}

function sanitizeTunnelName(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "relyycast-local";
}

function sanitizeHostname(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\.+$/g, "");
  if (!normalized) {
    return "";
  }
  if (!/^[a-z0-9.-]+$/.test(normalized) || normalized.startsWith(".") || normalized.endsWith(".")) {
    return "";
  }
  return normalized;
}

function trimTrailingSeparators(pathname: string) {
  return pathname.replace(/[\\/]+$/g, "");
}

function joinPath(base: string, ...parts: string[]) {
  let joined = trimTrailingSeparators(base);
  for (const part of parts) {
    const normalized = part.replace(/^[\\/]+|[\\/]+$/g, "");
    if (!normalized) {
      continue;
    }
    joined = `${joined}/${normalized}`;
  }
  return joined;
}

function shellQuote(value: string) {
  if (!value) {
    return "\"\"";
  }
  if (!/[\s"]/g.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\\\"")}"`;
}

function buildCommand(executable: string, args: string[]) {
  return [shellQuote(executable), ...args.map((arg) => shellQuote(arg))].join(" ");
}

function normalizeExecutableForCommand(executable: string) {
  let normalized = executable.trim();
  if (!normalized) {
    return normalized;
  }

  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  if (normalized.startsWith(".\\")) {
    normalized = normalized.slice(2);
  }

  if (CLOUDFLARED_PLATFORM === "win") {
    normalized = normalized.replace(/\//g, "\\");
  }

  return normalized;
}

function isAbsoluteExecutablePath(value: string) {
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")) {
    return true;
  }
  if (CLOUDFLARED_PLATFORM !== "win" && value.startsWith("/")) {
    return true;
  }
  return false;
}

function normalizeRelativeExecutablePath(value: string) {
  let normalized = value;
  if (normalized.startsWith("./") || normalized.startsWith(".\\")) {
    normalized = normalized.slice(2);
  }
  if (CLOUDFLARED_PLATFORM === "win") {
    normalized = normalized.replace(/^[\\/]+/, "");
  }
  return normalized;
}

async function pathExists(pathname: string) {
  try {
    await filesystem.getStats(pathname);
    return true;
  } catch {
    return false;
  }
}

async function readFileIfPresent(pathname: string) {
  try {
    return await filesystem.readFile(pathname);
  } catch {
    return null;
  }
}

async function writeFile(pathname: string, content: string) {
  await filesystem.writeFile(pathname, content);
}

async function copyFile(sourcePath: string, destinationPath: string) {
  const content = await readFileIfPresent(sourcePath);
  if (content === null) {
    return false;
  }
  await writeFile(destinationPath, content);
  return true;
}

async function runCommand(executable: string, args: string[], cwd: string): Promise<CommandResult> {
  const normalizedExecutable = normalizeExecutableForCommand(executable);
  const command = buildCommand(normalizedExecutable, args);
  const result = await os.execCommand(command, { cwd });
  return {
    exitCode: result.exitCode,
    stdOut: result.stdOut ?? "",
    stdErr: result.stdErr ?? "",
  };
}

function extractTunnelId(text: string) {
  const match = text.match(TUNNEL_ID_PATTERN);
  return match ? match[0] : null;
}

async function resolveCloudflaredBinary(runtimeRoots: string[], explicitPath: string) {
  const resolveConfiguredPath = async (inputPath: string) => {
    const normalized = normalizeExecutablePath(inputPath);
    if (!normalized) {
      return null;
    }

    if (!/[\\/]/.test(normalized) && !normalized.startsWith(".")) {
      return normalized;
    }

    if (!isAbsoluteExecutablePath(normalized)) {
      const relativePath = normalizeRelativeExecutablePath(normalized);
      if (relativePath) {
        for (const root of runtimeRoots) {
          const candidate = joinPath(root, relativePath);
          if (await pathExists(candidate)) {
            return candidate;
          }
        }
      }
    }

    if (await pathExists(normalized)) {
      return normalized;
    }

    return normalized;
  };

  const normalizedExplicit = await resolveConfiguredPath(explicitPath);
  if (normalizedExplicit) {
    return normalizedExplicit;
  }

  const candidateDirectories = runtimeRoots.flatMap((root) => [
    joinPath(root, "build", "bin"),
    joinPath(root, "runtime", "cloudflared"),
    joinPath(root, "runtime", "cloudflared", CLOUDFLARED_PLATFORM),
    joinPath(root, "cloudflared"),
    joinPath(root, "cloudflared", CLOUDFLARED_PLATFORM),
    joinPath(root, "bin"),
  ]);
  const candidates = candidateDirectories.flatMap((directory) =>
    CLOUDFLARED_BINARY_CANDIDATES.map((binaryName) => joinPath(directory, binaryName)),
  );

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return CLOUDFLARED_BINARY_NAME;
}

function isPathLikeExecutable(value: string) {
  return /[\\/]/.test(value) || /^[A-Za-z]:/.test(value);
}

async function isCloudflaredExecutableAvailable(executable: string, cwd: string) {
  if (isPathLikeExecutable(executable)) {
    return pathExists(executable);
  }
  const versionResult = await runCommand(executable, ["--version"], cwd);
  return versionResult.exitCode === 0;
}

function getDefaultCloudflareDirectory(envs: Record<string, string>, configPath: string) {
  const home = envs.USERPROFILE || envs.HOME || "";
  const candidates = [
    home ? joinPath(home, ".cloudflared") : "",
    envs.APPDATA ? joinPath(envs.APPDATA, "cloudflared") : "",
    envs.LOCALAPPDATA ? joinPath(envs.LOCALAPPDATA, "cloudflared") : "",
    configPath ? joinPath(configPath, "cloudflared") : "",
  ].filter(Boolean);
  return candidates;
}

function getCloudflaredCommandCwd(runtimeRoots: string[], fallback: string) {
  const preferredRoot = runtimeRoots.find((root) => {
    const normalized = root.replace(/\\/g, "/").toLowerCase();
    return normalized && !normalized.endsWith("/build");
  });

  return preferredRoot || runtimeRoots[0] || fallback;
}

async function findCloudflareCert(defaultDirectories: string[], appCertPath: string) {
  if (await pathExists(appCertPath)) {
    return appCertPath;
  }
  for (const directory of defaultDirectories) {
    const candidate = joinPath(directory, "cert.pem");
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function waitForCloudflareCert(
  defaultDirectories: string[],
  appCertPath: string,
  timeoutMs = 15_000,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const discoveredPath = await findCloudflareCert(defaultDirectories, appCertPath);
    if (discoveredPath) {
      if (discoveredPath !== appCertPath) {
        await copyFile(discoveredPath, appCertPath);
      }

      if (await pathExists(appCertPath)) {
        return appCertPath;
      }
    }

    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }

  return null;
}

async function listTunnels(cloudflaredPath: string, certPath: string, cwd: string): Promise<TunnelListItem[]> {
  const result = await runCommand(
    cloudflaredPath,
    ["tunnel", "--origincert", certPath, "list", "--output", "json"],
    cwd,
  );
  if (result.exitCode !== 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdOut) as Array<{
      id?: unknown;
      name?: unknown;
    }>;
    return parsed
      .filter((item) => typeof item.id === "string" && typeof item.name === "string")
      .map((item) => ({
        id: item.id as string,
        name: item.name as string,
      }));
  } catch {
    return [];
  }
}

async function ensureTunnelExists(
  cloudflaredPath: string,
  certPath: string,
  tunnelName: string,
  cwd: string,
): Promise<{ tunnelId: string | null; message: string | null }> {
  const existing = (await listTunnels(cloudflaredPath, certPath, cwd)).find(
    (item) => item.name === tunnelName,
  );
  if (existing) {
    return { tunnelId: existing.id, message: null };
  }

  const createResult = await runCommand(
    cloudflaredPath,
    ["tunnel", "--origincert", certPath, "create", tunnelName],
    cwd,
  );
  if (createResult.exitCode !== 0) {
    return {
      tunnelId: null,
      message: createResult.stdErr || createResult.stdOut || "cloudflared tunnel create failed",
    };
  }

  const createdId = extractTunnelId(`${createResult.stdOut}\n${createResult.stdErr}`);
  if (createdId) {
    return { tunnelId: createdId, message: null };
  }

  const refreshed = (await listTunnels(cloudflaredPath, certPath, cwd)).find(
    (item) => item.name === tunnelName,
  );
  return {
    tunnelId: refreshed?.id ?? null,
    message: refreshed?.id ? null : "unable to resolve tunnel ID after creation",
  };
}

async function ensureCredentialsFile(
  tunnelId: string,
  appDirectory: string,
  defaultDirectories: string[],
) {
  const destination = joinPath(appDirectory, `${tunnelId}.json`);
  if (await pathExists(destination)) {
    return destination;
  }

  for (const directory of defaultDirectories) {
    const candidate = joinPath(directory, `${tunnelId}.json`);
    if (await pathExists(candidate) && (await copyFile(candidate, destination))) {
      return destination;
    }
  }

  return null;
}

async function ensureDnsRoute(
  cloudflaredPath: string,
  certPath: string,
  tunnelId: string,
  hostname: string,
  cwd: string,
) {
  if (!hostname) {
    return { ok: false, message: "cloudflare hostname is not configured; skipping DNS route" };
  }

  const routeResult = await runCommand(
    cloudflaredPath,
    ["tunnel", "--origincert", certPath, "route", "dns", tunnelId, hostname],
    cwd,
  );
  if (routeResult.exitCode === 0) {
    return { ok: true, message: null };
  }

  const combined = `${routeResult.stdOut}\n${routeResult.stdErr}`.toLowerCase();
  if (combined.includes("already exists")) {
    return { ok: true, message: null };
  }

  return {
    ok: false,
    message: routeResult.stdErr || routeResult.stdOut || "cloudflared tunnel route dns failed",
  };
}

function buildConfigYaml(
  tunnelId: string,
  credentialsPath: string,
  certPath: string,
  hostname: string,
  originUrl: string,
) {
  const lines: string[] = [
    `tunnel: ${tunnelId}`,
    `credentials-file: ${credentialsPath}`,
    `origincert: ${certPath}`,
    "ingress:",
  ];

  if (hostname) {
    lines.push(`  - hostname: ${hostname}`);
    lines.push(`    service: ${originUrl}`);
  } else {
    lines.push(`  - service: ${originUrl}`);
  }

  lines.push("  - service: http_status:404");
  return `${lines.join("\n")}\n`;
}

async function ensureCloudflareCert(
  cloudflaredPath: string,
  appDirectory: string,
  defaultDirectories: string[],
  cwd: string,
  trigger: EnsureCloudflareOnboardingInput["trigger"],
) {
  const appCertPath = joinPath(appDirectory, "cert.pem");

  const existing = await findCloudflareCert(defaultDirectories, appCertPath);
  if (existing && existing !== appCertPath) {
    await copyFile(existing, appCertPath);
  }
  if (await pathExists(appCertPath)) {
    return {
      certPath: appCertPath,
      loginRequired: false,
      message: null,
      lastUserPromptAt: null,
    };
  }

  if (trigger === "auto") {
    return {
      certPath: null,
      loginRequired: true,
      message: "Cloudflare setup is pending consent. Use Connect Cloudflare to start login.",
      lastUserPromptAt: null,
    };
  }

  const promptedAt = nowIso();
  const loginResult = await runCommand(
    cloudflaredPath,
    ["tunnel", "login"],
    cwd,
  );
  if (loginResult.exitCode !== 0 && !(await pathExists(appCertPath))) {
    return {
      certPath: null,
      loginRequired: true,
      message: loginResult.stdErr || loginResult.stdOut || "cloudflared tunnel login did not complete",
      lastUserPromptAt: promptedAt,
    };
  }

  const discoveredCertPath = await waitForCloudflareCert(defaultDirectories, appCertPath);
  if (discoveredCertPath) {
    return {
      certPath: discoveredCertPath,
      loginRequired: false,
      message: null,
      lastUserPromptAt: promptedAt,
    };
  }

  const fallback = await findCloudflareCert(defaultDirectories, appCertPath);
  if (fallback && fallback !== appCertPath) {
    await copyFile(fallback, appCertPath);
  }

  return {
    certPath: (await pathExists(appCertPath)) ? appCertPath : null,
    loginRequired: !(await pathExists(appCertPath)),
    message: (await pathExists(appCertPath))
      ? null
      : "cloudflared login completed but cert.pem was not found",
    lastUserPromptAt: promptedAt,
  };
}

export async function ensureCloudflareOnboarding(
  input: EnsureCloudflareOnboardingInput,
): Promise<EnsureCloudflareOnboardingResult> {
  const state = createDefaultCloudflareState();
  state.lastUserPromptAt = input.previousState?.lastUserPromptAt ?? null;
  state.lastAttemptAt = nowIso();
  state.lastCheckedAt = state.lastAttemptAt;
  state.status = "provisioning";
  state.requiresUserAction = false;
  state.nextAction = "none";

  const configPath = await os.getPath("config").catch(() => "");
  const envs = await os.getEnvs().catch(() => ({} as Record<string, string>));
  const appDirectory = joinPath(input.appDataDirectory, "cloudflare");
  const defaultDirectories = getDefaultCloudflareDirectory(envs, configPath);
  const commandCwd = getCloudflaredCommandCwd(input.runtimeRoots, appDirectory);

  try {
    await filesystem.createDirectory(appDirectory);
  } catch {
    // Directory already exists.
  }

  state.appDirectory = appDirectory;

  const tunnelNameFromEnv = sanitizeTunnelName(String(envs.RELYY_CLOUDFLARE_TUNNEL_NAME ?? ""));
  const hostnameFromEnv = sanitizeHostname(String(envs.RELYY_CLOUDFLARE_HOSTNAME ?? ""));
  const cloudflaredPathFromEnv = String(
    envs.RELYY_CLOUDFLARED_PATH ?? envs.RELYY_CLOUDFLARE_PATH ?? "",
  );

  const tunnelName = sanitizeTunnelName(
    sanitizeText(input.cloudflareTunnelName, 120) || tunnelNameFromEnv || "relyycast-local",
  );
  const hostname = sanitizeHostname(
    sanitizeText(input.cloudflareHostname, 220) || hostnameFromEnv,
  );
  const originUrl = sanitizeText(input.originUrl, 240) || "http://127.0.0.1:8177";
  const cloudflareMode = input.cloudflareMode === "named" ? "named" : "temporary";

  state.tunnelName = tunnelName;
  state.hostname = hostname || null;
  state.publicUrl = hostname ? `https://${hostname}` : null;

  const cloudflaredPath = await resolveCloudflaredBinary(
    input.runtimeRoots,
    input.cloudflaredPath || cloudflaredPathFromEnv,
  );
  state.binaryPath = cloudflaredPath;

  const binaryExists = await isCloudflaredExecutableAvailable(cloudflaredPath, appDirectory);
  if (!binaryExists) {
    state.status = "error";
    state.setupStage = "failed";
    state.message = `cloudflared binary not found or not executable (${cloudflaredPath}). Set cloudflaredPath or place binary in runtime/cloudflared or build/bin.`;
    state.canRetry = true;
    state.nextAction = "retry-cloudflare";
    return { state, launch: null };
  }

  const previousQuickTunnelUrl = input.previousState?.publicUrl ?? null;
  const shouldResumeQuickTunnel = input.trigger !== "auto" || isQuickTunnelUrl(previousQuickTunnelUrl);
  if (cloudflareMode === "temporary") {
    state.tunnelName = "temporary-public-url";
    state.publicUrl = isQuickTunnelUrl(previousQuickTunnelUrl) ? previousQuickTunnelUrl : null;
    state.hostname = getHostnameFromUrl(state.publicUrl);

    if (!shouldResumeQuickTunnel) {
      state.status = "pending-consent";
      state.setupStage = "idle";
      state.message = "No Cloudflare hostname is configured yet. Connect Cloudflare to start a temporary public URL, or add a hostname later for a named tunnel.";
      state.requiresUserAction = true;
      state.nextAction = "connect-cloudflare";
      state.canRetry = false;
      return { state, launch: null };
    }

    state.status = "ready";
    state.setupStage = "ready";
    state.loginRequired = false;
    state.requiresUserAction = false;
    state.nextAction = "none";
    state.canRetry = false;
    state.message = state.publicUrl
      ? "Temporary Cloudflare URL active. No Cloudflare domain is required."
      : "Starting temporary Cloudflare URL. No Cloudflare domain is required.";

    return {
      state,
      launch: {
        executable: cloudflaredPath,
        args: ["tunnel", "--url", originUrl],
      },
    };
  }

  if (!hostname) {
    state.status = input.trigger === "auto" ? "pending-consent" : "error";
    state.setupStage = "idle";
    state.message = "Custom Domain mode requires a Cloudflare-managed hostname. Add one in Settings or switch to Temporary URL.";
    state.requiresUserAction = true;
    state.loginRequired = false;
    state.nextAction = "connect-cloudflare";
    state.canRetry = false;
    return { state, launch: null };
  }

  const certResult = await ensureCloudflareCert(
    cloudflaredPath,
    appDirectory,
    defaultDirectories,
    commandCwd,
    input.trigger,
  );
  if (!certResult.certPath) {
    state.lastUserPromptAt = certResult.lastUserPromptAt ?? state.lastUserPromptAt;
    state.status = certResult.loginRequired
      ? (input.trigger === "auto" ? "pending-consent" : "login-required")
      : "error";
    state.loginRequired = certResult.loginRequired;
    state.message = certResult.message;
    state.requiresUserAction = certResult.loginRequired;
    state.nextAction = certResult.loginRequired ? "connect-cloudflare" : "retry-cloudflare";
    state.canRetry = input.trigger !== "auto" || !certResult.loginRequired;
    return { state, launch: null };
  }

  state.certPath = certResult.certPath;
  state.lastUserPromptAt = certResult.lastUserPromptAt ?? state.lastUserPromptAt;

  const tunnelResult = await ensureTunnelExists(
    cloudflaredPath,
    certResult.certPath,
    tunnelName,
    commandCwd,
  );
  if (!tunnelResult.tunnelId) {
    state.status = "error";
    state.message = tunnelResult.message;
    state.canRetry = true;
    state.nextAction = "retry-cloudflare";
    return { state, launch: null };
  }

  state.tunnelId = tunnelResult.tunnelId;

  const credentialsPath = await ensureCredentialsFile(
    tunnelResult.tunnelId,
    appDirectory,
    defaultDirectories,
  );
  if (!credentialsPath) {
    state.status = "error";
    state.message = "cloudflared credentials JSON not found after tunnel creation";
    state.canRetry = true;
    state.nextAction = "retry-cloudflare";
    return { state, launch: null };
  }

  state.credentialsPath = credentialsPath;

  const routeResult = await ensureDnsRoute(
    cloudflaredPath,
    certResult.certPath,
    tunnelResult.tunnelId,
    hostname,
    commandCwd,
  );
  state.dnsRouted = routeResult.ok;
  if (!routeResult.ok && hostname) {
    state.status = "error";
    state.message = routeResult.message;
    state.canRetry = true;
    state.nextAction = "retry-cloudflare";
    return { state, launch: null };
  }

  const tunnelConfigPath = normalizeExecutablePath(input.cloudflareConfigPath)
    || joinPath(appDirectory, "config.yml");
  const tunnelConfig = buildConfigYaml(
    tunnelResult.tunnelId,
    credentialsPath,
    certResult.certPath,
    hostname,
    originUrl,
  );

  await writeFile(tunnelConfigPath, tunnelConfig);
  state.configPath = tunnelConfigPath;

  state.status = "ready";
  state.setupStage = "ready";
  state.loginRequired = false;
  state.requiresUserAction = false;
  state.nextAction = "none";
  state.canRetry = false;
  state.message = routeResult.ok
    ? null
    : "cloudflare hostname is not configured; tunnel config written without DNS route";

  return {
    state,
    launch: {
      executable: cloudflaredPath,
      args: ["tunnel", "--config", tunnelConfigPath, "run", tunnelResult.tunnelId],
    },
  };
}
