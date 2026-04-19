import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TEMPLATE_PATH = path.join(REPO_ROOT, "scripts", "release", "templates", "patch-notes.template.md");
const OUTPUT_ROOT = path.join(REPO_ROOT, "dist", "release-notes");

function parseArgs(argv) {
  const args = {
    version: undefined,
    title: undefined,
    notesFile: undefined,
    date: new Date().toISOString().slice(0, 10),
    summary: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
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

    if (token.startsWith("--title=")) {
      args.title = token.slice("--title=".length);
      continue;
    }
    if (token === "--title") {
      args.title = argv[i + 1];
      i += 1;
      continue;
    }

    if (token.startsWith("--notes-file=")) {
      args.notesFile = token.slice("--notes-file=".length);
      continue;
    }
    if (token === "--notes-file") {
      args.notesFile = argv[i + 1];
      i += 1;
      continue;
    }

    if (token.startsWith("--date=")) {
      args.date = token.slice("--date=".length);
      continue;
    }
    if (token === "--date") {
      args.date = argv[i + 1];
      i += 1;
      continue;
    }

    if (token.startsWith("--summary=")) {
      args.summary = token.slice("--summary=".length);
      continue;
    }
    if (token === "--summary") {
      args.summary = argv[i + 1];
      i += 1;
      continue;
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/release/generate-patch-notes.mjs --notes-file <path> [options]\n\nOptions:\n  --notes-file <path>  Markdown body source for notes (required)\n  --version <version>  Release version (default: package.json version)\n  --title <title>      Override release title (default: RelyyCast v<version>)\n  --summary <text>     Short summary for website payload\n  --date <YYYY-MM-DD>  Release date (default: today)\n  -h, --help           Show help\n\nOutput:\n  dist/release-notes/<version>/git-release-notes.md\n  dist/release-notes/<version>/website-patch-notes.md\n  dist/release-notes/<version>/website-sanity-payload.json\n`);
}

function getPackageVersion() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  return packageJson.version;
}

function loadNotesBody(notesFile) {
  const resolved = path.isAbsolute(notesFile) ? notesFile : path.join(REPO_ROOT, notesFile);
  if (!fs.existsSync(resolved)) {
    throw new Error(`notes file not found: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, "utf8").trim();
  if (!content) {
    throw new Error("notes file is empty");
  }
  return { resolved, content };
}

function inferSummary(content, explicitSummary) {
  if (explicitSummary) return explicitSummary;
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("- "));

  if (lines.length > 0) return lines[0].slice(0, 180);

  const bullet = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("- "));

  return bullet ? bullet.slice(2, 182) : "Patch update for RelyyCast.";
}

function buildGitMarkdown({ title, version, date, body }) {
  return `# ${title}\n\n- Product: RelyyCast\n- Version: ${version}\n- Release Date: ${date}\n\n${body}\n`;
}

function buildWebsiteMarkdown({ title, version, date, body }) {
  return `# ${title}\n\nReleased ${date}\n\nVersion: ${version}\n\n${body}\n`;
}

function buildSanityPayload({ title, version, date, summary, body }) {
  const slug = `relyycast-v${version.replace(/[^a-zA-Z0-9.-]/g, "-")}`;

  return {
    _type: "releaseNote",
    product: "relyycast",
    version,
    title,
    slug: { current: slug },
    releaseDate: date,
    summary,
    bodyMarkdown: body,
    channels: ["github", "website"],
    isPublished: false,
  };
}

function ensureTemplateExists() {
  if (fs.existsSync(TEMPLATE_PATH)) return;
  fs.mkdirSync(path.dirname(TEMPLATE_PATH), { recursive: true });
  fs.writeFileSync(
    TEMPLATE_PATH,
    `# Fixed\n\n- Describe bug fixes here\n\n# Improved\n\n- Describe improvements here\n\n# Notes\n\n- Add any migration or operational notes here\n`,
    "utf8",
  );
}

function writeOutputs(version, files) {
  const outDir = path.join(OUTPUT_ROOT, version);
  fs.mkdirSync(outDir, { recursive: true });

  const written = [];
  for (const [name, content] of Object.entries(files)) {
    const outPath = path.join(outDir, name);
    fs.writeFileSync(outPath, content, "utf8");
    written.push(outPath);
  }
  return written;
}

function main() {
  ensureTemplateExists();

  const args = parseArgs(process.argv.slice(2));
  if (!args.notesFile) {
    throw new Error(`--notes-file is required. Template: ${TEMPLATE_PATH}`);
  }

  const version = args.version || getPackageVersion();
  const title = args.title || `RelyyCast v${version}`;
  const notes = loadNotesBody(args.notesFile);
  const summary = inferSummary(notes.content, args.summary);

  const gitMarkdown = buildGitMarkdown({ title, version, date: args.date, body: notes.content });
  const websiteMarkdown = buildWebsiteMarkdown({ title, version, date: args.date, body: notes.content });
  const sanityPayload = buildSanityPayload({
    title,
    version,
    date: args.date,
    summary,
    body: notes.content,
  });

  const written = writeOutputs(version, {
    "git-release-notes.md": gitMarkdown,
    "website-patch-notes.md": websiteMarkdown,
    "website-sanity-payload.json": `${JSON.stringify(sanityPayload, null, 2)}\n`,
  });

  console.log("[release:notes] Notes source:", notes.resolved);
  for (const file of written) {
    console.log("[release:notes] Wrote:", file);
  }
}

try {
  main();
} catch (error) {
  console.error("[release:notes] ERROR:", error.message);
  process.exit(1);
}
