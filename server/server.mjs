import http from "node:http";
import https from "node:https";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = Number(process.env.RELYY_SERVER_PORT ?? process.env.RELYY_STREAM_PORT ?? 8177);

const DEFAULT_MOUNT = normalizeMountPath(process.env.RELYY_STREAM_DEFAULT_MOUNT ?? "/live.mp3") ?? "/live.mp3";
const SOURCE_METHOD = (process.env.RELYY_STREAM_SOURCE_METHOD ?? "SOURCE").toUpperCase();
const SOURCE_USER = process.env.RELYY_STREAM_SOURCE_USER ?? "source";
const SOURCE_PASSWORD = process.env.RELYY_STREAM_SOURCE_PASSWORD ?? "";
const ALLOW_ANON_SOURCE =
  String(process.env.RELYY_STREAM_ALLOW_ANON_SOURCE ?? "").toLowerCase() === "true" ||
  process.env.RELYY_STREAM_ALLOW_ANON_SOURCE === "1";
const KEEP_LISTENERS_ON_SOURCE_END =
  String(process.env.RELYY_STREAM_KEEP_LISTENERS_ON_SOURCE_END ?? "").toLowerCase() === "true" ||
  process.env.RELYY_STREAM_KEEP_LISTENERS_ON_SOURCE_END === "1";
const ICY_META_INT = Math.max(256, Number(process.env.RELYY_STREAM_ICY_METAINT ?? 16000));

const PAIRING_TTL_MS = 5 * 60 * 1000;
const FFMPEG_RESTART_BACKOFF_MS = 2000;
const MEDIAMTX_RESTART_BACKOFF_MS = 3000;i 
const SAMPLE_RATE = process.env.RELYY_STREAM_SAMPLE_RATE ?? "44100";
const CHANNELS = process.env.RELYY_STREAM_CHANNELS ?? "2";
const CONFIG_FILE_PATH = path.resolve(process.cwd(), ".tmp", "relyy-config.json");
const SERVER_DIR_PATH = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_MEDIAMTX_RTMP_URL = "rtmp://127.0.0.1:1935";
const DEFAULT_MEDIAMTX_HLS_ORIGIN = "http://127.0.0.1:8888";
const DEFAULT_MEDIAMTX_API_ORIGIN = "http://127.0.0.1:9997";

const DEFAULT_CONFIG = Object.freeze({
  inputUrl: "http://127.0.0.1:4850/live.mp3",
  stationName: "RelyyCast Dev Stream",
  genre: "Various",
  description: "Local FFmpeg test source",
  bitrate: "128k",
  ffmpegPath: "",
  relayPath: "live",
  mediamtxPath: "",
  mediamtxConfigPath: "",
});

// Step 1: API compatibility is intentionally locked during the merge.
const API_COMPATIBILITY = Object.freeze({
  pairStart: ["/api/pair/start", "/api/desktop/pair/start"],
  pairApprove: ["/api/pair/approve", "/api/desktop/pair/approve"],
  pairStatus: ["/api/pair/status", "/api/desktop/pair/status"],
  heartbeat: ["/api/heartbeat", "/api/desktop/heartbeat"],
  mountListing: ["/mounts", "/api/mounts"],
  metadataUpdate: ["/metadata", "/admin/metadata"],
});

const mountMap = new Map();
const pairingsByCode = new Map();
const heartbeatsByAgent = new Map();
const startedAt = Date.now();

let configFromFile = { ...DEFAULT_CONFIG };
let shuttingDown = false;

let mediamtxProc = null;
let ingestFfmpegProc = null;
let bridgeFfmpegProc = null;
let bridgeIngestReq = null;

let mediamtxRestartRequested = false;
let suppressMediatxRestartOnce = false;
let mediamtxRestartTimer = null;

let ingestRestartRequested = false;
let suppressIngestRestartOnce = false;
let ingestRestartTimer = null;

let bridgeRestartRequested = false;
let suppressBridgeRestartOnce = false;
let bridgeRestartTimer = null;
let bridgeStartPending = false;

const relayProcessState = createProcessState();
const ingestProcessState = createProcessState();
const bridgeProcessState = createProcessState();

await initializeConfigFile();

function createProcessState() {
  return {
    running: false,
    pid: null,
    lastStartAt: 0,
    lastExitAt: 0,
    lastExitCode: null,
    lastError: null,
  };
}

function markProcessStarted(state, proc) {
  state.running = true;
  state.pid = proc.pid ?? null;
  state.lastStartAt = Date.now();
  state.lastError = null;
}

function markProcessErrored(state, message) {
  state.lastError = message;
}

function markProcessStopped(state, exitCode) {
  state.running = false;
  state.pid = null;
  state.lastExitAt = Date.now();
  state.lastExitCode = typeof exitCode === "number" ? exitCode : null;
}

function serializeProcessState(state) {
  return {
    running: state.running,
    pid: state.pid,
    lastStartAt: state.lastStartAt ? new Date(state.lastStartAt).toISOString() : null,
    lastExitAt: state.lastExitAt ? new Date(state.lastExitAt).toISOString() : null,
    lastExitCode: state.lastExitCode,
    lastError: state.lastError,
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, SOURCE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Icy-MetaData, Range",
  };
}

function writeJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function normalizeExecutablePath(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/^"(.*)"$/, "$1");
}

function normalizeMountPath(rawPath) {
  if (typeof rawPath !== "string") {
    return null;
  }

  const mount = rawPath.trim();
  if (!mount || mount === "/") {
    return null;
  }

  if (!mount.startsWith("/") || mount.includes("..") || mount.includes("?")) {
    return null;
  }

  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/.test(mount)) {
    return null;
  }
  return mount;
}

function normalizeRelayPath(value) {
  if (typeof value !== "string") {
    return DEFAULT_CONFIG.relayPath;
  }

  const relayPath = value.trim().replace(/^\/+|\/+$/g, "");
  if (!relayPath || relayPath.includes("..")) {
    return DEFAULT_CONFIG.relayPath;
  }

  if (!/^[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/.test(relayPath)) {
    return DEFAULT_CONFIG.relayPath;
  }
  return relayPath;
}

function isReservedPath(pathname) {
  return (
    pathname === "/health" ||
    pathname === "/mounts" ||
    pathname === "/api/mounts" ||
    pathname === "/metadata" ||
    pathname === "/admin/metadata" ||
    pathname === "/api/config" ||
    pathname === "/hls" ||
    pathname === "/hls/" ||
    pathname.startsWith("/hls/") ||
    pathname.startsWith("/api/")
  );
}

function sanitizeMetadataValue(value, maxLength = 240) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/[\r\n]/g, " ").slice(0, maxLength).trim();
}

function sanitizeIcyField(value) {
  return sanitizeMetadataValue(value).replace(/'/g, "\\'").replace(/;/g, ",");
}

function normalizeConfig(input) {
  return {
    inputUrl: sanitizeMetadataValue(String(input.inputUrl ?? DEFAULT_CONFIG.inputUrl), 500) || DEFAULT_CONFIG.inputUrl,
    stationName: sanitizeMetadataValue(String(input.stationName ?? DEFAULT_CONFIG.stationName), 120) || DEFAULT_CONFIG.stationName,
    genre: sanitizeMetadataValue(String(input.genre ?? DEFAULT_CONFIG.genre), 120) || DEFAULT_CONFIG.genre,
    description: sanitizeMetadataValue(String(input.description ?? DEFAULT_CONFIG.description), 180) || DEFAULT_CONFIG.description,
    bitrate: sanitizeMetadataValue(String(input.bitrate ?? DEFAULT_CONFIG.bitrate), 24) || DEFAULT_CONFIG.bitrate,
    ffmpegPath: normalizeExecutablePath(input.ffmpegPath ?? DEFAULT_CONFIG.ffmpegPath),
    relayPath: normalizeRelayPath(String(input.relayPath ?? DEFAULT_CONFIG.relayPath)),
    mediamtxPath: normalizeExecutablePath(input.mediamtxPath ?? DEFAULT_CONFIG.mediamtxPath),
    mediamtxConfigPath: normalizeExecutablePath(input.mediamtxConfigPath ?? DEFAULT_CONFIG.mediamtxConfigPath),
  };
}

function applyEnvOverrides(baseConfig) {
  const envInputUrl = process.env.RELYY_SERVER_INPUT_URL ?? process.env.RELYY_STREAM_INPUT_URL;
  const envStationName = process.env.RELYY_SERVER_STATION_NAME ?? process.env.RELYY_STREAM_ICE_NAME;
  const envGenre = process.env.RELYY_SERVER_GENRE ?? process.env.RELYY_STREAM_ICE_GENRE;
  const envDescription = process.env.RELYY_SERVER_DESCRIPTION ?? process.env.RELYY_STREAM_ICE_DESCRIPTION;
  const envBitrate = process.env.RELYY_SERVER_BITRATE ?? process.env.RELYY_STREAM_BITRATE;
  const envFfmpegPath =
    process.env.RELYY_SERVER_FFMPEG_PATH ??
    process.env.FFMPEG_BIN ??
    process.env.RELYY_RADIO_FFMPEG_PATH;
  const envRelayPath = process.env.RELYY_SERVER_RELAY_PATH ?? process.env.RELYY_STREAM_RELAY_PATH;
  const envMediatxPath = process.env.RELYY_MEDIAMTX_PATH;
  const envMediatxConfigPath = process.env.RELYY_MEDIAMTX_CONFIG;

  return normalizeConfig({
    ...baseConfig,
    ...(envInputUrl ? { inputUrl: envInputUrl } : {}),
    ...(envStationName ? { stationName: envStationName } : {}),
    ...(envGenre ? { genre: envGenre } : {}),
    ...(envDescription ? { description: envDescription } : {}),
    ...(envBitrate ? { bitrate: envBitrate } : {}),
    ...(envFfmpegPath ? { ffmpegPath: envFfmpegPath } : {}),
    ...(envRelayPath ? { relayPath: envRelayPath } : {}),
    ...(envMediatxPath ? { mediamtxPath: envMediatxPath } : {}),
    ...(envMediatxConfigPath ? { mediamtxConfigPath: envMediatxConfigPath } : {}),
  });
}

function getRuntimeConfig() {
  return applyEnvOverrides(configFromFile);
}

function normalizeBaseUrl(rawValue, fallback) {
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  const candidate = value || fallback;
  return candidate.replace(/\/+$/g, "");
}

function getRelayEndpoints(config) {
  const relayPath = normalizeRelayPath(config.relayPath ?? DEFAULT_CONFIG.relayPath);
  const rtmpBaseUrl = normalizeBaseUrl(process.env.RELYY_MEDIAMTX_RTMP_URL, DEFAULT_MEDIAMTX_RTMP_URL);
  const hlsOrigin = normalizeBaseUrl(process.env.RELYY_MEDIAMTX_HLS_ORIGIN, DEFAULT_MEDIAMTX_HLS_ORIGIN);
  const apiOrigin = normalizeBaseUrl(process.env.RELYY_MEDIAMTX_API_ORIGIN, DEFAULT_MEDIAMTX_API_ORIGIN);

  return {
    relayPath,
    rtmpBaseUrl,
    rtmpPublishUrl: `${rtmpBaseUrl}/${relayPath}`,
    rtmpReadUrl: `${rtmpBaseUrl}/${relayPath}`,
    hlsOrigin,
    hlsPath: `/hls/${relayPath}/index.m3u8`,
    apiOrigin,
  };
}

function hasRelayProcessConfigChanged(previousConfig, nextConfig) {
  return (
    previousConfig.mediamtxPath !== nextConfig.mediamtxPath ||
    previousConfig.mediamtxConfigPath !== nextConfig.mediamtxConfigPath
  );
}

async function initializeConfigFile() {
  const configDir = path.dirname(CONFIG_FILE_PATH);
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }

  if (!existsSync(CONFIG_FILE_PATH)) {
    configFromFile = { ...DEFAULT_CONFIG };
    await writeFile(CONFIG_FILE_PATH, `${JSON.stringify(configFromFile, null, 2)}\n`, "utf8");
    return;
  }

  try {
    const raw = await readFile(CONFIG_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    configFromFile = normalizeConfig({ ...DEFAULT_CONFIG, ...(parsed && typeof parsed === "object" ? parsed : {}) });
  } catch {
    configFromFile = { ...DEFAULT_CONFIG };
    await writeFile(CONFIG_FILE_PATH, `${JSON.stringify(configFromFile, null, 2)}\n`, "utf8");
  }
}

async function persistConfig(patch) {
  const next = normalizeConfig({ ...configFromFile, ...patch });
  configFromFile = next;
  await writeFile(CONFIG_FILE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

async function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(parsed && typeof parsed === "object" ? parsed : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function parseBasicAuthorization(headerValue) {
  if (!headerValue || typeof headerValue !== "string" || !headerValue.startsWith("Basic ")) {
    return null;
  }
  try {
    const decoded = Buffer.from(headerValue.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator === -1) {
      return null;
    }
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function isSourceAuthorized(req) {
  if (ALLOW_ANON_SOURCE || !SOURCE_PASSWORD) {
    return true;
  }
  const auth = parseBasicAuthorization(req.headers.authorization);
  return Boolean(auth && auth.username === SOURCE_USER && auth.password === SOURCE_PASSWORD);
}

function createMount(mountPath) {
  const cfg = getRuntimeConfig();
  return {
    path: mountPath,
    listeners: new Set(),
    source: null,
    bytesIn: 0,
    chunkCount: 0,
    startedAt: Date.now(),
    lastChunkAt: 0,
    contentType: "audio/mpeg",
    metadata: {
      name: cfg.stationName,
      description: cfg.description,
      genre: cfg.genre,
      url: "",
      song: "",
      updatedAt: Date.now(),
    },
  };
}

function getOrCreateMount(mountPath) {
  let mount = mountMap.get(mountPath);
  if (!mount) {
    mount = createMount(mountPath);
    mountMap.set(mountPath, mount);
  }
  return mount;
}

function getTotalListenerCount() {
  let count = 0;
  for (const mount of mountMap.values()) {
    count += mount.listeners.size;
  }
  return count;
}

function summarizeMount(mount) {
  return {
    path: mount.path,
    sourceConnected: Boolean(mount.source),
    listenerCount: mount.listeners.size,
    bytesIn: mount.bytesIn,
    chunkCount: mount.chunkCount,
    lastChunkAt: mount.lastChunkAt ? new Date(mount.lastChunkAt).toISOString() : null,
    metadata: {
      ...mount.metadata,
      updatedAt: mount.metadata.updatedAt ? new Date(mount.metadata.updatedAt).toISOString() : null,
    },
  };
}

function buildIcyMetadataBlock(mount) {
  const title = sanitizeIcyField(mount.metadata.song);
  const url = sanitizeIcyField(mount.metadata.url);

  if (!title && !url) {
    return Buffer.from([0]);
  }

  const fields = [`StreamTitle='${title}';`];
  if (url) {
    fields.push(`StreamUrl='${url}';`);
  }

  const payload = Buffer.from(fields.join(""), "utf8");
  const lengthByte = Math.ceil(payload.length / 16);
  const block = Buffer.alloc(1 + lengthByte * 16);
  block[0] = lengthByte;
  payload.copy(block, 1);
  return block;
}

function removeListener(mount, listener) {
  mount.listeners.delete(listener);
}

function writeToListenerOrDrop(mount, listener, chunk) {
  if (listener.res.destroyed || listener.res.writableEnded) {
    removeListener(mount, listener);
    return false;
  }

  const ok = listener.res.write(chunk);
  if (!ok) {
    listener.res.destroy();
    removeListener(mount, listener);
    return false;
  }
  return true;
}

function fanOutChunkToMount(mount, chunk) {
  mount.bytesIn += chunk.length;
  mount.chunkCount += 1;
  mount.lastChunkAt = Date.now();

  for (const listener of mount.listeners) {
    if (!listener.wantsIcyMetadata) {
      writeToListenerOrDrop(mount, listener, chunk);
      continue;
    }

    let offset = 0;
    while (offset < chunk.length) {
      const bytesToWrite = Math.min(listener.bytesUntilMetadata, chunk.length - offset);
      const slice = chunk.subarray(offset, offset + bytesToWrite);
      const wroteAudio = writeToListenerOrDrop(mount, listener, slice);
      if (!wroteAudio) {
        break;
      }

      offset += bytesToWrite;
      listener.bytesUntilMetadata -= bytesToWrite;
      if (listener.bytesUntilMetadata === 0) {
        const metadataBlock = buildIcyMetadataBlock(mount);
        const wroteMetadata = writeToListenerOrDrop(mount, listener, metadataBlock);
        if (!wroteMetadata) {
          break;
        }
        listener.bytesUntilMetadata = ICY_META_INT;
      }
    }
  }
}

function endMountListeners(mount, reason) {
  for (const listener of mount.listeners) {
    if (!listener.res.writableEnded && !listener.res.destroyed) {
      listener.res.end();
    }
  }
  mount.listeners.clear();
  if (reason) {
    console.log(`[stream] mount ${mount.path} listeners closed (${reason})`);
  }
}

function getListenerHeaders(mount, wantsIcyMetadata) {
  const headers = {
    ...corsHeaders(),
    "Content-Type": mount.contentType,
    "Transfer-Encoding": "chunked",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
  };

  if (wantsIcyMetadata) {
    headers["icy-metaint"] = String(ICY_META_INT);
    headers["icy-name"] = mount.metadata.name || `RelyyCast ${mount.path}`;
    headers["icy-description"] = mount.metadata.description || "";
    headers["icy-genre"] = mount.metadata.genre || "";
    headers["icy-url"] = mount.metadata.url || "";
  }
  return headers;
}

function handleListener(req, res, mountPath) {
  const mount = getOrCreateMount(mountPath);
  const wantsIcyMetadata = String(req.headers["icy-metadata"] ?? "") === "1";
  const headers = getListenerHeaders(mount, wantsIcyMetadata);

  if (req.method === "HEAD") {
    res.writeHead(200, headers);
    res.end();
    return;
  }

  res.writeHead(200, headers);

  const listener = {
    res,
    wantsIcyMetadata,
    bytesUntilMetadata: ICY_META_INT,
  };
  mount.listeners.add(listener);

  res.on("close", () => {
    removeListener(mount, listener);
  });
}

function syncMountMetadataFromConfig(config) {
  const mount = mountMap.get(DEFAULT_MOUNT);
  if (!mount) {
    return;
  }
  mount.metadata.name = config.stationName;
  mount.metadata.description = config.description;
  mount.metadata.genre = config.genre;
  mount.metadata.updatedAt = Date.now();
}

function handleSource(req, res, mountPath) {
  if (!isSourceAuthorized(req)) {
    writeJson(
      res,
      401,
      { ok: false, error: "source authorization failed" },
      { "WWW-Authenticate": 'Basic realm="RelyyCast Source"' },
    );
    return;
  }

  const mount = getOrCreateMount(mountPath);
  if (mount.source) {
    writeJson(res, 409, { ok: false, error: `source already connected on ${mountPath}` });
    return;
  }

  if (mountPath === DEFAULT_MOUNT) {
    const cfg = getRuntimeConfig();
    mount.metadata.name = cfg.stationName;
    mount.metadata.description = cfg.description;
    mount.metadata.genre = cfg.genre;
    mount.metadata.updatedAt = Date.now();
  }

  mount.source = {
    connectedAt: Date.now(),
    remoteAddress: req.socket.remoteAddress ?? null,
    userAgent: String(req.headers["user-agent"] ?? ""),
  };

  const contentType = sanitizeMetadataValue(String(req.headers["content-type"] ?? ""), 80);
  if (contentType.startsWith("audio/")) {
    mount.contentType = contentType;
  }

  if (!res.headersSent) {
    res.writeHead(200, {
      ...corsHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
  }

  req.on("data", (chunk) => {
    fanOutChunkToMount(mount, chunk);
  });

  const closeSource = (reason) => {
    mount.source = null;
    if (!KEEP_LISTENERS_ON_SOURCE_END) {
      endMountListeners(mount, reason);
    }
  };

  req.on("end", () => {
    closeSource("source ended");
    if (!res.writableEnded) {
      res.end("ok\n");
    }
  });

  req.on("error", () => {
    closeSource("source error");
    if (!res.writableEnded) {
      res.end("source stream error\n");
    }
  });

  req.on("close", () => {
    if (mount.source) {
      closeSource("source disconnected");
      if (!res.writableEnded) {
        res.end();
      }
    }
  });
}

function toHttpStatusCode(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function findRelayPathEntry(payload, relayPath) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (item.name === relayPath || item.path === relayPath) {
      return item;
    }
  }
  return null;
}

async function fetchJson(urlValue, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(urlValue);
    } catch {
      resolve({ ok: false, statusCode: null, payload: null });
      return;
    }

    const transport = target.protocol === "https:" ? https : http;
    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port ? Number(target.port) : undefined,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const statusCode = toHttpStatusCode(response.statusCode);
          let payload = null;
          if (chunks.length) {
            try {
              payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              payload = null;
            }
          }
          resolve({
            ok: Boolean(statusCode && statusCode >= 200 && statusCode < 300),
            statusCode,
            payload,
          });
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy();
      resolve({ ok: false, statusCode: null, payload: null });
    });
    request.on("error", () => {
      resolve({ ok: false, statusCode: null, payload: null });
    });
    request.end();
  });
}

async function getRelayHealth(config) {
  const relayEndpoints = getRelayEndpoints(config);
  const response = await fetchJson(`${relayEndpoints.apiOrigin}/v3/paths/list`);
  const relayPathEntry = findRelayPathEntry(response.payload, relayEndpoints.relayPath);
  const relayPathReady = Boolean(
    relayPathEntry &&
      (relayPathEntry.sourceReady === true ||
        relayPathEntry.ready === true ||
        relayPathEntry.hasSource === true),
  );

  return {
    ...relayEndpoints,
    apiReachable: response.ok,
    apiStatusCode: response.statusCode,
    relayPathFound: Boolean(relayPathEntry),
    relayPathReady,
  };
}

async function handleHealth(res) {
  const mounts = Array.from(mountMap.values()).map((mount) => summarizeMount(mount));

  let bytesIn = 0;
  let chunkCount = 0;
  let lastChunkAt = 0;
  for (const mount of mountMap.values()) {
    bytesIn += mount.bytesIn;
    chunkCount += mount.chunkCount;
    if (mount.lastChunkAt > lastChunkAt) {
      lastChunkAt = mount.lastChunkAt;
    }
  }

  const relayHealth = await getRelayHealth(getRuntimeConfig());

  writeJson(res, 200, {
    ok: true,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    listenerCount: getTotalListenerCount(),
    mountCount: mounts.length,
    bytesIn,
    chunkCount,
    lastChunkAt: lastChunkAt ? new Date(lastChunkAt).toISOString() : null,
    relayPath: relayHealth.relayPath,
    relayPathReady: relayHealth.relayPathReady,
    hlsUrl: relayHealth.hlsPath,
    relay: {
      ...serializeProcessState(relayProcessState),
      apiReachable: relayHealth.apiReachable,
      apiStatusCode: relayHealth.apiStatusCode,
      relayPathFound: relayHealth.relayPathFound,
      relayPathReady: relayHealth.relayPathReady,
      apiOrigin: relayHealth.apiOrigin,
      rtmpUrl: relayHealth.rtmpPublishUrl,
      hlsOrigin: relayHealth.hlsOrigin,
      hlsUrl: relayHealth.hlsPath,
    },
    ingest: serializeProcessState(ingestProcessState),
    mp3Bridge: serializeProcessState(bridgeProcessState),
    mounts,
  });
}

function handleMountListing(res) {
  writeJson(res, 200, {
    ok: true,
    mounts: Array.from(mountMap.values()).map((mount) => summarizeMount(mount)),
  });
}

function handleMetadataUpdate(url, res) {
  const mountPath = normalizeMountPath(url.searchParams.get("mount") ?? "");
  if (!mountPath) {
    writeJson(res, 400, { ok: false, error: "mount query param is required" });
    return;
  }

  const mount = getOrCreateMount(mountPath);
  const titleCandidate = url.searchParams.get("song") ?? url.searchParams.get("title");

  if (titleCandidate !== null) {
    mount.metadata.song = sanitizeMetadataValue(titleCandidate);
  }
  if (url.searchParams.get("name") !== null) {
    mount.metadata.name = sanitizeMetadataValue(url.searchParams.get("name"), 120);
  }
  if (url.searchParams.get("description") !== null) {
    mount.metadata.description = sanitizeMetadataValue(url.searchParams.get("description"), 180);
  }
  if (url.searchParams.get("genre") !== null) {
    mount.metadata.genre = sanitizeMetadataValue(url.searchParams.get("genre"), 120);
  }
  if (url.searchParams.get("url") !== null) {
    mount.metadata.url = sanitizeMetadataValue(url.searchParams.get("url"), 180);
  }
  mount.metadata.updatedAt = Date.now();

  writeJson(res, 200, {
    ok: true,
    mount: summarizeMount(mount),
  });
}

function cleanupExpiredPairings() {
  const now = Date.now();
  for (const [code, pairing] of pairingsByCode) {
    if (pairing.expiresAt <= now && pairing.status === "pending") {
      pairingsByCode.set(code, { ...pairing, status: "expired" });
    }
  }
}

function generatePairingCode() {
  return `RLY-${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function handlePairStart(req, res) {
  const body = await readJsonBody(req);
  const stationId = typeof body.stationId === "string" && body.stationId.trim() ? body.stationId.trim() : "station-dev";

  cleanupExpiredPairings();
  let pairingCode = generatePairingCode();
  while (pairingsByCode.has(pairingCode)) {
    pairingCode = generatePairingCode();
  }

  const createdAt = Date.now();
  const record = {
    id: randomBytes(8).toString("hex"),
    pairingCode,
    stationId,
    deviceName: typeof body.deviceName === "string" ? body.deviceName : "Unknown device",
    platform: typeof body.platform === "string" ? body.platform : "unknown",
    appVersion: typeof body.appVersion === "string" ? body.appVersion : "0.0.0",
    createdAt,
    expiresAt: createdAt + PAIRING_TTL_MS,
    status: "pending",
  };

  pairingsByCode.set(record.pairingCode, record);
  writeJson(res, 200, {
    pairingId: record.id,
    pairingCode: record.pairingCode,
    stationId: record.stationId,
    status: record.status,
    expiresAt: new Date(record.expiresAt).toISOString(),
  });
}

async function handlePairApprove(req, res) {
  const body = await readJsonBody(req);
  const pairingCode = typeof body.pairingCode === "string" ? body.pairingCode.trim().toUpperCase() : "";
  if (!pairingCode) {
    writeJson(res, 400, { error: "pairingCode is required" });
    return;
  }

  cleanupExpiredPairings();
  const existing = pairingsByCode.get(pairingCode);
  if (!existing) {
    writeJson(res, 404, { error: "Pairing code not found" });
    return;
  }

  const approved = {
    ...existing,
    status: existing.status === "pending" ? "approved" : existing.status,
    approvedAt: Date.now(),
  };
  pairingsByCode.set(pairingCode, approved);

  writeJson(res, 200, {
    pairingCode,
    status: approved.status,
    approvedAt: approved.approvedAt ? new Date(approved.approvedAt).toISOString() : null,
  });
}

function readPairingCodeFromQuery(url) {
  const raw = url.searchParams.get("pairingCode");
  return raw ? raw.trim().toUpperCase() : "";
}

async function readPairingCodeFromBody(req) {
  const body = await readJsonBody(req);
  return typeof body.pairingCode === "string" ? body.pairingCode.trim().toUpperCase() : "";
}

function writePairStatusResponse(res, pairingCode) {
  cleanupExpiredPairings();
  const pairing = pairingsByCode.get(pairingCode);
  if (!pairing) {
    writeJson(res, 404, { error: "Pairing code not found" });
    return;
  }

  if (pairing.status === "approved") {
    pairingsByCode.set(pairingCode, {
      ...pairing,
      status: "consumed",
      consumedAt: Date.now(),
    });

    writeJson(res, 200, {
      status: "approved",
      stationId: pairing.stationId,
      agentConfig: {
        localPort: PORT,
        streamPath: DEFAULT_MOUNT,
        healthPath: "/health",
        tunnelToken: "dev-token-placeholder",
      },
    });
    return;
  }

  writeJson(res, 200, {
    status: pairing.status,
    stationId: pairing.stationId,
    expiresAt: new Date(pairing.expiresAt).toISOString(),
  });
}

async function handlePairStatus(req, res, url) {
  const pairingCode =
    req.method === "GET"
      ? readPairingCodeFromQuery(url)
      : await readPairingCodeFromBody(req);

  if (!pairingCode) {
    writeJson(res, 400, { error: "pairingCode is required" });
    return;
  }
  writePairStatusResponse(res, pairingCode);
}

async function handleHeartbeatPost(req, res) {
  const body = await readJsonBody(req);
  const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
  const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";

  if (!stationId || !agentId) {
    writeJson(res, 400, { error: "stationId and agentId are required" });
    return;
  }

  const heartbeat = {
    stationId,
    agentId,
    status: typeof body.status === "string" ? body.status : "online",
    encoderStatus: typeof body.encoderStatus === "string" ? body.encoderStatus : "running",
    tunnelStatus: typeof body.tunnelStatus === "string" ? body.tunnelStatus : "connected",
    listenerCount: typeof body.listenerCount === "number" ? body.listenerCount : 0,
    localPort: typeof body.localPort === "number" ? body.localPort : PORT,
    lastSeenAt: Date.now(),
  };

  heartbeatsByAgent.set(agentId, heartbeat);
  writeJson(res, 200, {
    ok: true,
    heartbeat: {
      ...heartbeat,
      lastSeenAt: new Date(heartbeat.lastSeenAt).toISOString(),
    },
  });
}

function handleHeartbeatGet(res, url) {
  const agentId = url.searchParams.get("agentId")?.trim();
  if (!agentId) {
    writeJson(res, 400, { error: "agentId query param is required" });
    return;
  }

  const heartbeat = heartbeatsByAgent.get(agentId);
  if (!heartbeat) {
    writeJson(res, 404, { error: "No heartbeat found for agent" });
    return;
  }

  writeJson(res, 200, {
    heartbeat: {
      ...heartbeat,
      lastSeenAt: new Date(heartbeat.lastSeenAt).toISOString(),
    },
  });
}

function resolveFfmpegPath(config) {
  const configPath = normalizeExecutablePath(config.ffmpegPath);
  if (configPath) {
    return configPath;
  }

  const ffmpegBin = normalizeExecutablePath(process.env.FFMPEG_BIN);
  if (ffmpegBin) {
    return ffmpegBin;
  }

  const relyyRadioFfmpegPath = normalizeExecutablePath(process.env.RELYY_RADIO_FFMPEG_PATH);
  if (relyyRadioFfmpegPath) {
    return relyyRadioFfmpegPath;
  }

  if (process.platform === "win32") {
    const windowsCandidates = [
      path.resolve(process.cwd(), "bin", "ffmpeg.exe"),
      "C:\\ffmpeg\\bin\\ffmpeg.exe",
      "C:\\ffmpeg\\ffmpeg.exe",
      "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
    ];

    for (const candidate of windowsCandidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

function resolveMediatxPath(config) {
  const explicitPath =
    normalizeExecutablePath(config.mediamtxPath) ||
    normalizeExecutablePath(process.env.RELYY_MEDIAMTX_PATH) ||
    normalizeExecutablePath(process.env.MEDIAMTX_BIN);
  if (explicitPath) {
    return explicitPath;
  }

  const runtimeRoots = Array.from(
    new Set([process.cwd(), path.resolve(process.cwd(), "build"), path.resolve(SERVER_DIR_PATH, "..")]),
  );

  if (process.platform === "win32") {
    const windowsCandidates = [
      ...runtimeRoots.flatMap((rootPath) => [
        path.resolve(rootPath, "mediamtx", "win", "mediamtx.exe"),
        path.resolve(rootPath, "bin", "mediamtx.exe"),
        path.resolve(rootPath, "bin", "mediamtx", "mediamtx.exe"),
      ]),
      "C:\\mediamtx\\mediamtx.exe",
    ];
    for (const candidate of windowsCandidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return "mediamtx.exe";
  }

  const unixCandidates = [
    ...runtimeRoots.flatMap((rootPath) => [
      ...(process.platform === "darwin" ? [path.resolve(rootPath, "mediamtx", "mac", "mediamtx")] : []),
      path.resolve(rootPath, "bin", "mediamtx"),
    ]),
    "/usr/local/bin/mediamtx",
    "/opt/homebrew/bin/mediamtx",
  ];
  for (const candidate of unixCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "mediamtx";
}

function resolveMediatxConfigPath(config) {
  const explicitPath =
    normalizeExecutablePath(config.mediamtxConfigPath) ||
    normalizeExecutablePath(process.env.RELYY_MEDIAMTX_CONFIG);
  if (explicitPath) {
    return explicitPath;
  }

  const runtimeRoots = Array.from(
    new Set([process.cwd(), path.resolve(process.cwd(), "build"), path.resolve(SERVER_DIR_PATH, "..")]),
  );
  const configCandidates = runtimeRoots.flatMap((rootPath) => [
    path.resolve(rootPath, "mediamtx", "mediamtx.yml"),
    path.resolve(rootPath, "server", "mediamtx.yml"),
  ]);

  for (const candidate of configCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

function buildMediatxArgs(config) {
  const configPath = resolveMediatxConfigPath(config);
  return configPath ? [configPath] : [];
}

function getFfmpegReconnectArgs(inputUrl) {
  const source = typeof inputUrl === "string" ? inputUrl.trim().toLowerCase() : "";

  if (source.startsWith("http://") || source.startsWith("https://")) {
    return ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "2"];
  }

  return [];
}

function buildIngestFfmpegArgs(config, rtmpPublishUrl) {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    ...getFfmpegReconnectArgs(config.inputUrl),
    "-i",
    config.inputUrl,
    "-vn",
    "-ac",
    CHANNELS,
    "-ar",
    SAMPLE_RATE,
    "-c:a",
    "aac",
    "-b:a",
    config.bitrate,
    "-f",
    "flv",
    rtmpPublishUrl,
  ];
}

function buildBridgeFfmpegArgs(config, rtmpReadUrl) {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-i",
    rtmpReadUrl,
    "-vn",
    "-ac",
    CHANNELS,
    "-ar",
    SAMPLE_RATE,
    "-c:a",
    "libmp3lame",
    "-b:a",
    config.bitrate,
    "-f",
    "mp3",
    "pipe:1",
  ];
}

function clearMediatxRestartTimer() {
  if (mediamtxRestartTimer) {
    clearTimeout(mediamtxRestartTimer);
    mediamtxRestartTimer = null;
  }
}

function clearIngestRestartTimer() {
  if (ingestRestartTimer) {
    clearTimeout(ingestRestartTimer);
    ingestRestartTimer = null;
  }
}

function clearBridgeRestartTimer() {
  if (bridgeRestartTimer) {
    clearTimeout(bridgeRestartTimer);
    bridgeRestartTimer = null;
  }
}

function scheduleMediatxRestart() {
  if (shuttingDown || mediamtxRestartTimer) {
    return;
  }
  mediamtxRestartTimer = setTimeout(() => {
    mediamtxRestartTimer = null;
    startMediatx();
  }, MEDIAMTX_RESTART_BACKOFF_MS);
}

function scheduleIngestRestart() {
  if (shuttingDown || ingestRestartTimer) {
    return;
  }
  ingestRestartTimer = setTimeout(() => {
    ingestRestartTimer = null;
    startIngestFfmpeg();
  }, FFMPEG_RESTART_BACKOFF_MS);
}

function scheduleBridgeRestart() {
  if (shuttingDown || bridgeRestartTimer) {
    return;
  }
  bridgeRestartTimer = setTimeout(() => {
    bridgeRestartTimer = null;
    startBridgeFfmpeg();
  }, FFMPEG_RESTART_BACKOFF_MS);
}

function destroyBridgeIngestRequest() {
  if (bridgeIngestReq) {
    bridgeIngestReq.destroy();
    bridgeIngestReq = null;
  }
}

function createBridgeIngestRequest(config) {
  const sourceAuth = SOURCE_PASSWORD
    ? Buffer.from(`${SOURCE_USER}:${SOURCE_PASSWORD}`, "utf8").toString("base64")
    : null;

  const request = http.request(
    {
      hostname: HOST,
      port: PORT,
      path: DEFAULT_MOUNT,
      method: SOURCE_METHOD,
      headers: {
        "Content-Type": "audio/mpeg",
        "Transfer-Encoding": "chunked",
        Connection: "keep-alive",
        "User-Agent": "relyycast-mp3-bridge/1.0",
        "Ice-Name": config.stationName,
        "Ice-Genre": config.genre,
        "Ice-Description": config.description,
        ...(sourceAuth ? { Authorization: `Basic ${sourceAuth}` } : {}),
      },
    },
    (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      response.on("end", () => {
        if (body.trim()) {
          console.log(`[mp3-bridge] source response ${response.statusCode}: ${body.trim()}`);
        }
      });
    },
  );

  request.on("error", (error) => {
    console.error(`[mp3-bridge] source request error: ${error.message}`);
    if (bridgeFfmpegProc && !bridgeFfmpegProc.killed) {
      bridgeFfmpegProc.kill("SIGINT");
    }
  });

  return request;
}

function startMediatx() {
  if (shuttingDown || mediamtxProc) {
    return;
  }

  clearMediatxRestartTimer();
  const config = getRuntimeConfig();
  const mediamtxPath = resolveMediatxPath(config);
  const args = buildMediatxArgs(config);

  console.log(`[relay] spawning ${mediamtxPath} ${args.join(" ")}`.trim());
  mediamtxProc = spawn(mediamtxPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  mediamtxProc.on("spawn", () => {
    markProcessStarted(relayProcessState, mediamtxProc);
    startIngestFfmpeg();
    startBridgeFfmpeg();
  });

  mediamtxProc.stdout.on("data", (chunk) => {
    const line = chunk.toString("utf8").trim();
    if (line) {
      console.log(`[mediamtx] ${line}`);
    }
  });

  mediamtxProc.stderr.on("data", (chunk) => {
    const line = chunk.toString("utf8").trim();
    if (line) {
      console.log(`[mediamtx] ${line}`);
    }
  });

  mediamtxProc.on("error", (error) => {
    markProcessErrored(relayProcessState, error.message);
    if (error && error.code === "ENOENT") {
      console.error(`[relay] mediamtx not found at "${mediamtxPath}"`);
      console.error("[relay] provide RELYY_MEDIAMTX_PATH or bundle mediamtx binary.");
    } else {
      console.error(`[relay] failed to start mediamtx: ${error.message}`);
    }
  });

  mediamtxProc.on("close", (code) => {
    const shouldRestartFromFailure = !shuttingDown && !suppressMediatxRestartOnce && code !== 0;
    const shouldStartAfterRequestedRestart = mediamtxRestartRequested && !shuttingDown;

    suppressMediatxRestartOnce = false;
    mediamtxRestartRequested = false;
    markProcessStopped(relayProcessState, code);
    mediamtxProc = null;

    if (ingestFfmpegProc && !ingestFfmpegProc.killed) {
      suppressIngestRestartOnce = true;
      ingestFfmpegProc.kill("SIGINT");
    }
    if (bridgeFfmpegProc && !bridgeFfmpegProc.killed) {
      suppressBridgeRestartOnce = true;
      bridgeFfmpegProc.kill("SIGINT");
    }

    console.log(`[relay] mediamtx exited with code ${code ?? "unknown"}`);

    if (shouldStartAfterRequestedRestart) {
      startMediatx();
      return;
    }

    if (shouldRestartFromFailure) {
      scheduleMediatxRestart();
    }
  });
}

function startIngestFfmpeg() {
  if (shuttingDown || ingestFfmpegProc) {
    return;
  }

  if (!mediamtxProc) {
    scheduleIngestRestart();
    return;
  }

  clearIngestRestartTimer();
  const config = getRuntimeConfig();
  const relayEndpoints = getRelayEndpoints(config);
  const ffmpegPath = resolveFfmpegPath(config);
  const args = buildIngestFfmpegArgs(config, relayEndpoints.rtmpPublishUrl);

  console.log(`[ingest] spawning ${ffmpegPath} ${args.join(" ")}`);
  ingestFfmpegProc = spawn(ffmpegPath, args, {
    stdio: ["ignore", "ignore", "pipe"],
  });

  ingestFfmpegProc.on("spawn", () => {
    markProcessStarted(ingestProcessState, ingestFfmpegProc);
  });

  ingestFfmpegProc.on("error", (error) => {
    markProcessErrored(ingestProcessState, error.message);
    if (error && error.code === "ENOENT") {
      console.error(`[ingest] ffmpeg not found at "${ffmpegPath}"`);
      console.error("[ingest] install FFmpeg or set config.ffmpegPath / RELYY_SERVER_FFMPEG_PATH / FFMPEG_BIN.");
    } else {
      console.error(`[ingest] failed to start ffmpeg: ${error.message}`);
    }
  });

  ingestFfmpegProc.stderr.on("data", (chunk) => {
    const line = chunk.toString("utf8").trim();
    if (line) {
      console.log(`[ffmpeg-ingest] ${line}`);
    }
  });

  ingestFfmpegProc.on("close", (code) => {
    const shouldRestartFromFailure = !shuttingDown && !suppressIngestRestartOnce && code !== 0;
    const shouldStartAfterRequestedRestart = ingestRestartRequested && !shuttingDown;

    suppressIngestRestartOnce = false;
    ingestRestartRequested = false;
    markProcessStopped(ingestProcessState, code);
    ingestFfmpegProc = null;

    console.log(`[ingest] ffmpeg exited with code ${code ?? "unknown"}`);

    if (shouldStartAfterRequestedRestart) {
      startIngestFfmpeg();
      return;
    }

    if (shouldRestartFromFailure) {
      scheduleIngestRestart();
    }
  });
}

async function startBridgeFfmpeg() {
  if (shuttingDown || bridgeFfmpegProc || bridgeStartPending) {
    return;
  }

  bridgeStartPending = true;

  try {
    if (!mediamtxProc) {
      scheduleBridgeRestart();
      return;
    }

    clearBridgeRestartTimer();
    destroyBridgeIngestRequest();

    const config = getRuntimeConfig();
    const relayEndpoints = getRelayEndpoints(config);
    const relayHealth = await getRelayHealth(config);
    if (!relayHealth.relayPathReady) {
      scheduleBridgeRestart();
      return;
    }

    const ffmpegPath = resolveFfmpegPath(config);
    const args = buildBridgeFfmpegArgs(config, relayEndpoints.rtmpReadUrl);

    console.log(`[mp3-bridge] spawning ${ffmpegPath} ${args.join(" ")}`);
    bridgeFfmpegProc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    bridgeFfmpegProc.on("spawn", () => {
      markProcessStarted(bridgeProcessState, bridgeFfmpegProc);
    });

    bridgeFfmpegProc.on("error", (error) => {
      markProcessErrored(bridgeProcessState, error.message);
      if (error && error.code === "ENOENT") {
        console.error(`[mp3-bridge] ffmpeg not found at "${ffmpegPath}"`);
        console.error("[mp3-bridge] install FFmpeg or set config.ffmpegPath / RELYY_SERVER_FFMPEG_PATH / FFMPEG_BIN.");
      } else {
        console.error(`[mp3-bridge] failed to start ffmpeg: ${error.message}`);
      }
    });

    bridgeFfmpegProc.stdout.on("data", (chunk) => {
      if (!bridgeIngestReq) {
        bridgeIngestReq = createBridgeIngestRequest(config);
      }

      const ok = bridgeIngestReq.write(chunk);
      if (!ok) {
        bridgeFfmpegProc.stdout.pause();
        bridgeIngestReq.once("drain", () => {
          if (bridgeFfmpegProc?.stdout) {
            bridgeFfmpegProc.stdout.resume();
          }
        });
      }
    });

    bridgeFfmpegProc.stderr.on("data", (chunk) => {
      const line = chunk.toString("utf8").trim();
      if (line) {
        console.log(`[ffmpeg-mp3-bridge] ${line}`);
      }
    });

    bridgeFfmpegProc.on("close", (code) => {
      const shouldRestartFromFailure = !shuttingDown && !suppressBridgeRestartOnce && code !== 0;
      const shouldStartAfterRequestedRestart = bridgeRestartRequested && !shuttingDown;

      suppressBridgeRestartOnce = false;
      bridgeRestartRequested = false;
      markProcessStopped(bridgeProcessState, code);
      bridgeFfmpegProc = null;

      if (bridgeIngestReq) {
        bridgeIngestReq.end();
        bridgeIngestReq = null;
      }

      console.log(`[mp3-bridge] ffmpeg exited with code ${code ?? "unknown"}`);

      if (shouldStartAfterRequestedRestart) {
        startBridgeFfmpeg();
        return;
      }

      if (shouldRestartFromFailure) {
        scheduleBridgeRestart();
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markProcessErrored(bridgeProcessState, message);
    console.error(`[mp3-bridge] failed before spawn: ${message}`);
    scheduleBridgeRestart();
  } finally {
    bridgeStartPending = false;
  }
}

function restartMediatx(reason) {
  if (shuttingDown) {
    return;
  }

  console.log(`[relay] restart requested (${reason})`);
  clearMediatxRestartTimer();

  if (!mediamtxProc) {
    startMediatx();
    return;
  }

  mediamtxRestartRequested = true;
  suppressMediatxRestartOnce = true;
  mediamtxProc.kill("SIGINT");
}

function restartIngestFfmpeg(reason) {
  if (shuttingDown) {
    return;
  }

  console.log(`[ingest] restart requested (${reason})`);
  clearIngestRestartTimer();

  if (!ingestFfmpegProc) {
    startIngestFfmpeg();
    return;
  }

  ingestRestartRequested = true;
  suppressIngestRestartOnce = true;
  ingestFfmpegProc.kill("SIGINT");
}

function restartBridgeFfmpeg(reason) {
  if (shuttingDown) {
    return;
  }

  console.log(`[mp3-bridge] restart requested (${reason})`);
  clearBridgeRestartTimer();
  destroyBridgeIngestRequest();

  if (!bridgeFfmpegProc) {
    startBridgeFfmpeg();
    return;
  }

  bridgeRestartRequested = true;
  suppressBridgeRestartOnce = true;
  bridgeFfmpegProc.kill("SIGINT");
}

async function stopBridgeFfmpeg() {
  clearBridgeRestartTimer();
  destroyBridgeIngestRequest();

  if (!bridgeFfmpegProc) {
    return;
  }

  await new Promise((resolve) => {
    const proc = bridgeFfmpegProc;
    proc.once("close", () => resolve());
    proc.kill("SIGINT");
  });
}

async function stopIngestFfmpeg() {
  clearIngestRestartTimer();

  if (!ingestFfmpegProc) {
    return;
  }

  await new Promise((resolve) => {
    const proc = ingestFfmpegProc;
    proc.once("close", () => resolve());
    proc.kill("SIGINT");
  });
}

async function stopMediatx() {
  clearMediatxRestartTimer();

  if (!mediamtxProc) {
    return;
  }

  await new Promise((resolve) => {
    const proc = mediamtxProc;
    proc.once("close", () => resolve());
    proc.kill("SIGINT");
  });
}

function pathMatches(pathname, options) {
  return options.includes(pathname);
}

function isHopByHopHeader(headerName) {
  const lower = headerName.toLowerCase();
  return (
    lower === "connection" ||
    lower === "keep-alive" ||
    lower === "proxy-authenticate" ||
    lower === "proxy-authorization" ||
    lower === "te" ||
    lower === "trailer" ||
    lower === "transfer-encoding" ||
    lower === "upgrade"
  );
}

function buildHlsProxyHeaders(req) {
  const forwardedHeaders = {};
  const passthrough = [
    "accept",
    "accept-encoding",
    "accept-language",
    "cache-control",
    "if-none-match",
    "if-modified-since",
    "origin",
    "range",
    "referer",
    "user-agent",
  ];

  for (const key of passthrough) {
    const value = req.headers[key];
    if (typeof value === "string" && value) {
      forwardedHeaders[key] = value;
    }
  }
  return forwardedHeaders;
}

async function proxyHlsRequest(req, res, url) {
  const relayEndpoints = getRelayEndpoints(getRuntimeConfig());
  let targetOrigin;
  try {
    targetOrigin = new URL(relayEndpoints.hlsOrigin);
  } catch {
    writeJson(res, 500, { ok: false, error: "invalid RELYY_MEDIAMTX_HLS_ORIGIN value" });
    return;
  }

  const suffixPath = url.pathname.slice("/hls".length) || "/";
  const upstreamPath = `${suffixPath}${url.search}`;
  const transport = targetOrigin.protocol === "https:" ? https : http;

  await new Promise((resolve) => {
    const proxyReq = transport.request(
      {
        protocol: targetOrigin.protocol,
        hostname: targetOrigin.hostname,
        port: targetOrigin.port ? Number(targetOrigin.port) : undefined,
        method: req.method,
        path: upstreamPath,
        headers: buildHlsProxyHeaders(req),
      },
      (proxyRes) => {
        const headers = {};
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (isHopByHopHeader(key)) {
            continue;
          }
          headers[key] = value;
        }

        res.writeHead(proxyRes.statusCode ?? 502, {
          ...headers,
          ...corsHeaders(),
          "Cache-Control": "no-store, no-transform",
        });

        if (req.method === "HEAD") {
          proxyRes.resume();
          res.end();
          resolve();
          return;
        }

        proxyRes.pipe(res);
        proxyRes.on("end", () => resolve());
      },
    );

    proxyReq.on("error", (error) => {
      if (!res.headersSent) {
        writeJson(res, 502, { ok: false, error: `hls proxy upstream error: ${error.message}` });
      } else {
        res.end();
      }
      resolve();
    });

    proxyReq.end();
  });
}

async function handleRequest(req, res) {
  if (!req.url || !req.method) {
    writeJson(res, 400, { ok: false, error: "invalid request" });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
  const method = req.method.toUpperCase();
  const pathname = url.pathname;

  if ((method === "GET" || method === "HEAD") && (pathname === "/hls" || pathname === "/hls/" || pathname.startsWith("/hls/"))) {
    await proxyHlsRequest(req, res, url);
    return;
  }

  if (method === "GET" && pathname === "/health") {
    await handleHealth(res);
    return;
  }

  if (method === "GET" && pathMatches(pathname, API_COMPATIBILITY.mountListing)) {
    handleMountListing(res);
    return;
  }

  if ((method === "GET" || method === "POST") && pathMatches(pathname, API_COMPATIBILITY.metadataUpdate)) {
    handleMetadataUpdate(url, res);
    return;
  }

  if (method === "GET" && pathname === "/api/config") {
    writeJson(res, 200, getRuntimeConfig());
    return;
  }

  if (method === "POST" && pathname === "/api/config") {
    const previousConfig = { ...configFromFile };
    const body = await readJsonBody(req);
    const nextConfig = await persistConfig(body);
    syncMountMetadataFromConfig(getRuntimeConfig());
    restartIngestFfmpeg("config update");
    restartBridgeFfmpeg("config update");
    if (hasRelayProcessConfigChanged(previousConfig, nextConfig)) {
      restartMediatx("relay config update");
    }
    writeJson(res, 200, getRuntimeConfig());
    return;
  }

  if (method === "POST" && pathMatches(pathname, API_COMPATIBILITY.pairStart)) {
    await handlePairStart(req, res);
    return;
  }

  if (method === "POST" && pathMatches(pathname, API_COMPATIBILITY.pairApprove)) {
    await handlePairApprove(req, res);
    return;
  }

  if ((method === "GET" || method === "POST") && pathMatches(pathname, API_COMPATIBILITY.pairStatus)) {
    await handlePairStatus(req, res, url);
    return;
  }

  if (method === "POST" && pathMatches(pathname, API_COMPATIBILITY.heartbeat)) {
    await handleHeartbeatPost(req, res);
    return;
  }

  if (method === "GET" && pathMatches(pathname, API_COMPATIBILITY.heartbeat)) {
    handleHeartbeatGet(res, url);
    return;
  }

  const mountPath = normalizeMountPath(pathname);
  if (!mountPath || isReservedPath(mountPath)) {
    writeJson(res, 404, { ok: false, error: "not found" });
    return;
  }

  if (method === "GET" || method === "HEAD") {
    handleListener(req, res, mountPath);
    return;
  }

  if (method === "SOURCE" || method === "PUT" || method === "POST") {
    handleSource(req, res, mountPath);
    return;
  }

  writeJson(res, 405, { ok: false, error: "method not allowed" });
}

const server = http.createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    console.error("[server] unhandled request error:", error);
    if (!res.headersSent) {
      writeJson(res, 500, { ok: false, error: "internal server error" });
      return;
    }
    res.end();
  });
});

server.requestTimeout = 0;
server.timeout = 0;
server.keepAliveTimeout = 0;

server.listen(PORT, HOST, () => {
  console.log(`[server] unified server listening on http://${HOST}:${PORT}`);
  console.log(`[server] source endpoint: ${SOURCE_METHOD}|PUT|POST ${DEFAULT_MOUNT}`);
  console.log("[server] listener endpoint: GET /<mount>");
  console.log("[server] hls proxy endpoint: GET /hls/<relayPath>/index.m3u8");
  startMediatx();
});

process.on("SIGINT", async () => {
  console.log("[server] shutting down...");
  shuttingDown = true;
  for (const mount of mountMap.values()) {
    endMountListeners(mount, "shutdown");
  }

  await stopBridgeFfmpeg();
  await stopIngestFfmpeg();
  await stopMediatx();
  server.close(() => {
    process.exit(0);
  });
});
