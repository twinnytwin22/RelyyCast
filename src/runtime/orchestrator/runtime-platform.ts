import { filesystem } from "@neutralinojs/lib";

function trimTrailingSeparators(pathname: string) {
  return pathname.replace(/[\\/]+$/g, "");
}

export function joinPath(base: string, ...parts: string[]) {
  let joined = trimTrailingSeparators(base);
  for (const part of parts) {
    const normalizedPart = part.replace(/^[\\/]+|[\\/]+$/g, "");
    if (!normalizedPart) {
      continue;
    }
    joined = `${joined}/${normalizedPart}`;
  }
  return joined;
}

function dedupeStrings(values: Array<string | undefined | null>) {
  const output: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    const normalized = value.trim();
    if (!normalized || output.includes(normalized)) {
      continue;
    }
    output.push(normalized);
  }
  return output;
}

export function hasNeutralinoGlobals() {
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

export function deriveRuntimeRoots() {
  if (typeof window === "undefined") {
    return [];
  }

  const nlPath = (window.NL_PATH ?? "").trim();
  const nlCwd = (window.NL_CWD ?? "").trim();
  const roots = dedupeStrings([nlPath, nlCwd]);

  for (const root of [...roots]) {
    const normalized = root.replace(/\\/g, "/").toLowerCase();
    if (!normalized.endsWith("/build")) {
      continue;
    }
    const parent = root.replace(/[\\/]build$/i, "");
    if (parent && !roots.includes(parent)) {
      roots.push(parent);
    }
  }

  return roots;
}

async function pathExists(pathname: string) {
  try {
    await filesystem.getStats(pathname);
    return true;
  } catch {
    return false;
  }
}

export async function findFirstExisting(paths: string[]) {
  for (const candidate of paths) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
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

export function buildCommand(executable: string, args: string[]) {
  return [shellQuote(executable), ...args.map((arg) => shellQuote(arg))].join(" ");
}

export function getPlatformName() {
  const source = String(window.NL_OS ?? "").toLowerCase();
  if (source.includes("windows")) {
    return "windows";
  }
  if (source.includes("darwin") || source.includes("mac")) {
    return "darwin";
  }
  return "linux";
}

export function getArchName() {
  const source = String(window.NL_ARCH ?? "").toLowerCase();
  if (source.includes("arm64") || source === "arm") {
    return "arm64";
  }
  return "x64";
}

export function isWindows() {
  return getPlatformName() === "windows";
}

export function normalizeExecutableForSpawn(executable: string) {
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

  if (isWindows()) {
    normalized = normalized.replace(/\//g, "\\");
  }

  return normalized;
}

export function getProcessCwd() {
  const roots = deriveRuntimeRoots();
  if (!roots.length) {
    return undefined;
  }
  const preferredRoot = roots.find((root) => !root.replace(/\\/g, "/").toLowerCase().endsWith("/build"));
  return preferredRoot ?? roots[0];
}
