import http from "node:http";

const argv = process.argv.slice(2);

function readOption(name: string) {
  const inlinePrefix = `${name}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === name) {
      const next = argv[index + 1];
      return typeof next === "string" ? next : undefined;
    }
    if (current.startsWith(inlinePrefix)) {
      return current.slice(inlinePrefix.length);
    }
  }
  return undefined;
}

const HOST = readOption("--host") ?? process.env.RELYY_MP3_HELPER_HOST ?? "127.0.0.1";
const PORT = Number(readOption("--port") ?? process.env.RELYY_MP3_HELPER_PORT ?? process.env.RELYY_STREAM_PORT ?? 8177);

const DEFAULT_MOUNT = normalizeMountPath(readOption("--mount") ?? process.env.RELYY_STREAM_DEFAULT_MOUNT ?? "/live.mp3") ?? "/live.mp3";
const SOURCE_METHOD = (readOption("--source-method") ?? process.env.RELYY_STREAM_SOURCE_METHOD ?? "SOURCE").toUpperCase();
const SOURCE_USER = readOption("--source-user") ?? process.env.RELYY_STREAM_SOURCE_USER ?? "source";
const SOURCE_PASSWORD = readOption("--source-password") ?? process.env.RELYY_STREAM_SOURCE_PASSWORD ?? "";
const ALLOW_ANON_SOURCE =
  String(readOption("--allow-anon-source") ?? process.env.RELYY_STREAM_ALLOW_ANON_SOURCE ?? "").toLowerCase() === "true" ||
  process.env.RELYY_STREAM_ALLOW_ANON_SOURCE === "1";
const KEEP_LISTENERS_ON_SOURCE_END =
  String(readOption("--keep-listeners-on-source-end") ?? process.env.RELYY_STREAM_KEEP_LISTENERS_ON_SOURCE_END ?? "").toLowerCase() === "true" ||
  process.env.RELYY_STREAM_KEEP_LISTENERS_ON_SOURCE_END === "1";
const ICY_META_INT = Math.max(256, Number(readOption("--icy-metaint") ?? process.env.RELYY_STREAM_ICY_METAINT ?? 16000));

const DEFAULT_STATION_NAME = sanitizeMetadataValue(readOption("--station-name") ?? process.env.RELYY_STREAM_ICE_NAME ?? "RelyyCast Dev Stream", 120);
const DEFAULT_STATION_GENRE = sanitizeMetadataValue(readOption("--station-genre") ?? process.env.RELYY_STREAM_ICE_GENRE ?? "Various", 120);
const DEFAULT_STATION_DESCRIPTION = sanitizeMetadataValue(
  readOption("--station-description") ?? process.env.RELYY_STREAM_ICE_DESCRIPTION ?? "Local MP3 source",
  180,
);
const DEFAULT_STATION_URL = sanitizeMetadataValue(readOption("--station-url") ?? process.env.RELYY_STREAM_ICE_URL ?? "", 180);

const API_COMPATIBILITY = Object.freeze({
  mountListing: ["/mounts", "/api/mounts"],
  metadataUpdate: ["/metadata", "/admin/metadata"],
});

type ListenerState = {
  res: http.ServerResponse;
  wantsIcyMetadata: boolean;
  bytesUntilMetadata: number;
};

type MountState = {
  path: string;
  listeners: Set<ListenerState>;
  source: null | {
    connectedAt: number;
    remoteAddress: string | null;
    userAgent: string;
  };
  bytesIn: number;
  chunkCount: number;
  startedAt: number;
  lastChunkAt: number;
  contentType: string;
  metadata: {
    name: string;
    description: string;
    genre: string;
    url: string;
    song: string;
    updatedAt: number;
  };
};

const mountMap = new Map<string, MountState>();
const startedAt = Date.now();
let shuttingDown = false;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, SOURCE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Icy-MetaData, Range",
  };
}

function writeJson(
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown,
  extraHeaders: Record<string, string | number> = {},
) {
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

function pathMatches(pathname: string, options: readonly string[]) {
  return options.includes(pathname);
}

function normalizeMountPath(rawPath: string | null | undefined) {
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

function isReservedPath(pathname: string) {
  return (
    pathname === "/_status" ||
    pathname === "/mounts" ||
    pathname === "/api/mounts" ||
    pathname === "/metadata" ||
    pathname === "/admin/metadata" ||
    pathname.startsWith("/api/")
  );
}

function sanitizeMetadataValue(value: unknown, maxLength = 240) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/[\r\n]/g, " ").slice(0, maxLength).trim();
}

function sanitizeIcyField(value: unknown) {
  return sanitizeMetadataValue(value).replace(/'/g, "\\'").replace(/;/g, ",");
}

function parseBasicAuthorization(headerValue: string | undefined) {
  if (!headerValue || !headerValue.startsWith("Basic ")) {
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

function isSourceAuthorized(req: http.IncomingMessage) {
  if (ALLOW_ANON_SOURCE || !SOURCE_PASSWORD) {
    return true;
  }
  const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : undefined;
  const auth = parseBasicAuthorization(authHeader);
  return Boolean(auth && auth.username === SOURCE_USER && auth.password === SOURCE_PASSWORD);
}

function createMount(mountPath: string): MountState {
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
      name: DEFAULT_STATION_NAME,
      description: DEFAULT_STATION_DESCRIPTION,
      genre: DEFAULT_STATION_GENRE,
      url: DEFAULT_STATION_URL,
      song: "",
      updatedAt: Date.now(),
    },
  };
}

function getOrCreateMount(mountPath: string) {
  let mount = mountMap.get(mountPath);
  if (!mount) {
    mount = createMount(mountPath);
    mountMap.set(mountPath, mount);
  }
  return mount;
}

function summarizeMount(mount: MountState) {
  return {
    path: mount.path,
    sourceConnected: Boolean(mount.source),
    listenerCount: mount.listeners.size,
    bytesIn: mount.bytesIn,
    chunkCount: mount.chunkCount,
    startedAt: new Date(mount.startedAt).toISOString(),
    lastChunkAt: mount.lastChunkAt ? new Date(mount.lastChunkAt).toISOString() : null,
    metadata: {
      ...mount.metadata,
      updatedAt: new Date(mount.metadata.updatedAt).toISOString(),
    },
  };
}

function getTotalListenerCount() {
  let count = 0;
  for (const mount of mountMap.values()) {
    count += mount.listeners.size;
  }
  return count;
}

function buildIcyMetadataBlock(mount: MountState) {
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

function removeListener(mount: MountState, listener: ListenerState) {
  mount.listeners.delete(listener);
}

function writeToListenerOrDrop(mount: MountState, listener: ListenerState, chunk: Buffer) {
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

function fanOutChunkToMount(mount: MountState, chunk: Buffer) {
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

function endMountListeners(mount: MountState, reason?: string) {
  for (const listener of mount.listeners) {
    if (!listener.res.writableEnded && !listener.res.destroyed) {
      listener.res.end();
    }
  }
  mount.listeners.clear();
  if (reason) {
    console.log(`[mp3-helper] mount ${mount.path} listeners closed (${reason})`);
  }
}

function getListenerHeaders(mount: MountState, wantsIcyMetadata: boolean) {
  const headers: Record<string, string> = {
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

function handleListener(req: http.IncomingMessage, res: http.ServerResponse, mountPath: string) {
  const mount = getOrCreateMount(mountPath);
  const wantsIcyMetadata = String(req.headers["icy-metadata"] ?? "") === "1";
  const headers = getListenerHeaders(mount, wantsIcyMetadata);

  if (req.method === "HEAD") {
    res.writeHead(200, headers);
    res.end();
    return;
  }

  res.writeHead(200, headers);

  const listener: ListenerState = {
    res,
    wantsIcyMetadata,
    bytesUntilMetadata: ICY_META_INT,
  };
  mount.listeners.add(listener);

  res.on("close", () => {
    removeListener(mount, listener);
  });
}

function handleSource(req: http.IncomingMessage, res: http.ServerResponse, mountPath: string) {
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
    mount.metadata.name = DEFAULT_STATION_NAME;
    mount.metadata.description = DEFAULT_STATION_DESCRIPTION;
    mount.metadata.genre = DEFAULT_STATION_GENRE;
    mount.metadata.url = DEFAULT_STATION_URL;
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

  req.on("data", (chunk: Buffer) => {
    fanOutChunkToMount(mount, chunk);
  });

  const closeSource = (reason: string) => {
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

function handleMetadataUpdate(url: URL, res: http.ServerResponse) {
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

function handleMountListing(res: http.ServerResponse) {
  writeJson(res, 200, {
    ok: true,
    mounts: Array.from(mountMap.values()).map((mount) => summarizeMount(mount)),
  });
}

function handleStatus(res: http.ServerResponse) {
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

  writeJson(res, 200, {
    ok: true,
    helper: "bun-mp3-helper",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    listenerCount: getTotalListenerCount(),
    mountCount: mountMap.size,
    bytesIn,
    chunkCount,
    lastChunkAt: lastChunkAt ? new Date(lastChunkAt).toISOString() : null,
    mounts: Array.from(mountMap.values()).map((mount) => summarizeMount(mount)),
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
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

  if (method === "GET" && pathname === "/_status") {
    handleStatus(res);
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

  const mountPath = normalizeMountPath(pathname);
  if (!mountPath || isReservedPath(mountPath)) {
    writeJson(res, 404, { ok: false, error: "not found" });
    return;
  }

  if (method === "GET" || method === "HEAD") {
    handleListener(req, res, mountPath);
    return;
  }

  if (method === SOURCE_METHOD || method === "SOURCE" || method === "PUT" || method === "POST") {
    handleSource(req, res, mountPath);
    return;
  }

  writeJson(res, 405, { ok: false, error: "method not allowed" });
}

const server = http.createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    console.error("[mp3-helper] unhandled request error:", error);
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
  console.log(`[mp3-helper] listening on http://${HOST}:${PORT}`);
  console.log(`[mp3-helper] source endpoint: ${SOURCE_METHOD}|SOURCE|PUT|POST ${DEFAULT_MOUNT}`);
  console.log("[mp3-helper] listener endpoint: GET /<mount>");
  console.log("[mp3-helper] private status endpoint: GET /_status");
});

function closeAllListeners(reason: string) {
  for (const mount of mountMap.values()) {
    endMountListeners(mount, reason);
  }
}

function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[mp3-helper] shutting down (${signal})...`);
  closeAllListeners("shutdown");
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
