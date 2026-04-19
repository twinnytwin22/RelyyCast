import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST_DIR = path.join(REPO_ROOT, "dist");

const ARTIFACT_CANDIDATES = [
  { filePath: path.join(DIST_DIR, "RelyyCast.pkg"), platform: "macos" },
  { filePath: path.join(DIST_DIR, "relyycast-setup.exe"), platform: "windows" },
  { filePath: path.join(DIST_DIR, "RelyyCast.AppImage"), platform: "linux" },
  { filePath: path.join(DIST_DIR, "relyycast.AppImage"), platform: "linux" },
  { filePath: path.join(DIST_DIR, "relyycast-linux-x64.AppImage"), platform: "linux" },
];

const ENV_KEYS = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_PREFIX", "S3_KEY", "S3_SECRET", "S3_PUBLIC_URL"];

function parseDotenv(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }

    out[key] = value;
  }
  return out;
}

function loadReleaseEnvFiles() {
  const candidates = [
    path.join(REPO_ROOT, ".env.release.local"),
    path.join(REPO_ROOT, ".env.local"),
    path.join(REPO_ROOT, ".env"),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const parsed = parseDotenv(fs.readFileSync(envPath, "utf8"));
    for (const key of ENV_KEYS) {
      if (!process.env[key] && parsed[key]) {
        process.env[key] = parsed[key];
      }
    }
  }
}

function parseArgs(argv) {
  const args = { dryRun: false, version: undefined, artifact: undefined, platform: undefined };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (token.startsWith("--version=")) {
      args.version = token.slice("--version=".length);
      continue;
    }
    if (token === "--version") {
      args.version = argv[i + 1];
      i += 1;
      continue;
    }

    if (token.startsWith("--artifact=")) {
      args.artifact = token.slice("--artifact=".length);
      continue;
    }
    if (token === "--artifact") {
      args.artifact = argv[i + 1];
      i += 1;
      continue;
    }

    if (token.startsWith("--platform=")) {
      args.platform = token.slice("--platform=".length);
      continue;
    }
    if (token === "--platform") {
      args.platform = argv[i + 1];
      i += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function normalizePlatform(raw) {
  if (!raw) return undefined;
  const value = raw.toLowerCase();
  if (["mac", "macos", "darwin", "osx"].includes(value)) return "macos";
  if (["win", "windows", "win32"].includes(value)) return "windows";
  if (["linux", "gnu/linux", "gnu-linux"].includes(value)) return "linux";
  return value;
}

function detectHostPlatform() {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  return process.platform;
}

function printHelp() {
  console.log(`Usage: node scripts/release/upload-r2.mjs [options]\n\nOptions:\n  --version <version>   Release version (defaults to package.json version)\n  --artifact <path>     Explicit artifact path (otherwise newest known artifact)\n  --platform <name>     Override platform segment in object key\n  --dry-run             Print plan without uploading\n  -h, --help            Show help\n\nRequired env vars:\n  S3_ENDPOINT, S3_BUCKET, S3_KEY, S3_SECRET\nOptional env vars:\n  S3_PREFIX (key prefix before releases/...); S3_REGION (default: auto), S3_PUBLIC_URL\n`);
}

function readPackageVersion() {
  const packageJsonPath = path.join(REPO_ROOT, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (!packageJson.version) {
    throw new Error("package.json is missing version");
  }
  return packageJson.version;
}

function resolveArtifact(artifactArg, platformHint) {
  const normalizedHint = normalizePlatform(platformHint);

  if (artifactArg) {
    const absolute = path.isAbsolute(artifactArg) ? artifactArg : path.join(REPO_ROOT, artifactArg);
    if (!fs.existsSync(absolute)) {
      throw new Error(`artifact not found: ${absolute}`);
    }
    return {
      filePath: absolute,
      platform: inferPlatformFromName(path.basename(absolute)),
      stat: fs.statSync(absolute),
    };
  }

  const existing = ARTIFACT_CANDIDATES
    .filter((candidate) => fs.existsSync(candidate.filePath))
    .map((candidate) => ({ ...candidate, stat: fs.statSync(candidate.filePath) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  if (existing.length === 0) {
    throw new Error("no release artifact found. Build first with: npm run installer:build");
  }

  if (normalizedHint) {
    const hinted = existing.filter((candidate) => normalizePlatform(candidate.platform) === normalizedHint);
    if (hinted.length > 0) {
      return hinted[0];
    }
  }

  return existing[0];
}

function inferPlatformFromName(fileName) {
  const normalizedFileName = fileName.toLowerCase();
  if (normalizedFileName.endsWith(".pkg")) return "macos";
  if (normalizedFileName.endsWith(".exe")) return "windows";
  if (
    normalizedFileName.endsWith(".appimage")
    || normalizedFileName.endsWith(".deb")
    || normalizedFileName.endsWith(".rpm")
    || normalizedFileName.endsWith(".snap")
    || normalizedFileName.endsWith(".tar.gz")
    || normalizedFileName.endsWith(".tar.xz")
  ) {
    return "linux";
  }
  return "unknown";
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
}

function normalizeRegion(endpoint, rawRegion) {
  const region = rawRegion || "auto";
  const r2AllowedRegions = new Set(["wnam", "enam", "weur", "eeur", "apac", "oc", "auto"]);
  const endpointLower = endpoint.toLowerCase();
  const isR2Endpoint = endpointLower.includes("r2.cloudflarestorage.com") || endpointLower.includes("cloudflare");

  if (!isR2Endpoint) {
    return region;
  }

  if (r2AllowedRegions.has(region)) {
    return region;
  }

  console.warn(
    `[release:r2] WARNING: S3_REGION='${region}' is not valid for R2 endpoint. Falling back to 'auto'.`,
  );
  return "auto";
}

function computeSha256(filePath) {
  const hash = crypto.createHash("sha256");
  const content = fs.readFileSync(filePath);
  hash.update(content);
  return hash.digest("hex");
}

function buildPublicUrl(publicBase, bucket, objectKey) {
  if (!publicBase) return null;
  return `${publicBase.replace(/\/$/, "")}/${bucket}/${objectKey}`;
}

function cleanPathSegment(value) {
  return (value || "").trim().replace(/^\/+|\/+$/g, "");
}

function joinObjectKey(...segments) {
  return segments.map(cleanPathSegment).filter(Boolean).join("/");
}

function parseBucketAndPrefix(rawBucket) {
  const cleaned = cleanPathSegment(rawBucket);
  if (!cleaned) {
    throw new Error("S3_BUCKET is empty after trimming");
  }

  const [bucket, ...rest] = cleaned.split("/");
  return { bucket, impliedPrefix: rest.join("/") };
}

async function uploadObject(s3, bucket, objectKey, body, contentType) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    }),
  );
}

async function main() {
  loadReleaseEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  const version = args.version || readPackageVersion();
  const hostPlatform = detectHostPlatform();
  const requestedPlatform = normalizePlatform(args.platform);
  const artifact = resolveArtifact(args.artifact, requestedPlatform || hostPlatform);
  const fileName = path.basename(artifact.filePath);
  const platform = requestedPlatform || normalizePlatform(artifact.platform) || hostPlatform;
  const checksum = computeSha256(artifact.filePath);

  const endpoint = requireEnv("S3_ENDPOINT");
  const rawBucket = requireEnv("S3_BUCKET");
  const { bucket, impliedPrefix } = parseBucketAndPrefix(rawBucket);
  const explicitPrefix = cleanPathSegment(process.env.S3_PREFIX || "");
  const basePrefix = explicitPrefix || impliedPrefix;
  if (explicitPrefix && impliedPrefix) {
    console.warn(
      "[release:r2] WARNING: S3_BUCKET contains a path and S3_PREFIX is set. Using S3_PREFIX and ignoring path part from S3_BUCKET.",
    );
  }
  const accessKeyId = requireEnv("S3_KEY");
  const secretAccessKey = requireEnv("S3_SECRET");
  const region = normalizeRegion(endpoint, process.env.S3_REGION);
  const releaseKeyRoot = joinObjectKey(basePrefix, version, platform);
  const objectKey = joinObjectKey(releaseKeyRoot, fileName);

  const metadata = {
    product: "relyycast",
    version,
    platform,
    fileName,
    objectKey,
    sha256: checksum,
    fileSizeBytes: artifact.stat.size,
    builtAt: artifact.stat.mtime.toISOString(),
    uploadedAt: new Date().toISOString(),
  };

  console.log("[release:r2] Artifact:", artifact.filePath);
  console.log("[release:r2] Version:", version);
  console.log("[release:r2] Bucket:", bucket);
  if (basePrefix) {
    console.log("[release:r2] Prefix:", basePrefix);
  }
  console.log("[release:r2] Object key:", objectKey);
  console.log("[release:r2] SHA256:", checksum);
  console.log("[release:r2] Region:", region);

  if (args.dryRun) {
    console.log("[release:r2] Dry run enabled, skipping upload.");
    return;
  }

  const s3 = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  await uploadObject(s3, bucket, objectKey, fs.createReadStream(artifact.filePath), "application/octet-stream");
  await uploadObject(s3, bucket, `${objectKey}.sha256`, `${checksum}  ${fileName}\n`, "text/plain; charset=utf-8");
  await uploadObject(
    s3,
    bucket,
    joinObjectKey(releaseKeyRoot, "manifest.json"),
    JSON.stringify(metadata, null, 2),
    "application/json; charset=utf-8",
  );

  const publicUrl = buildPublicUrl(process.env.S3_PUBLIC_URL, bucket, objectKey);
  const latestKey = joinObjectKey(basePrefix, platform, "latest.json");
  const latestPayload = {
    ...metadata,
    url: publicUrl || null,
  };
  await uploadObject(s3, bucket, latestKey, JSON.stringify(latestPayload, null, 2), "application/json; charset=utf-8");

  console.log("[release:r2] Upload complete.");
  if (publicUrl) {
    console.log("[release:r2] Public URL:", publicUrl);
  }
  const latestPublicUrl = buildPublicUrl(process.env.S3_PUBLIC_URL, bucket, latestKey);
  if (latestPublicUrl) {
    console.log("[release:r2] Latest manifest:", latestPublicUrl);
  }
}

main().catch((error) => {
  if (error.message.includes("The specified bucket does not exist")) {
    console.error(
      "[release:r2] ERROR: The bucket does not exist. Set S3_BUCKET to the actual bucket name and use S3_PREFIX for folder path (or S3_BUCKET=bucket/path).",
    );
  } else {
    console.error("[release:r2] ERROR:", error.message);
  }
  process.exit(1);
});
