import { spawn } from "node:child_process";

const APP_URL = process.env.APP_VIEW_URL ?? "http://127.0.0.1:3000";

async function isAppReachable(url) {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

function runNpmScript(scriptName) {
  return new Promise((resolve) => {
    const child = spawn(`npm run ${scriptName}`, {
      shell: true,
      stdio: "inherit",
      env: process.env,
    });

    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const alreadyRunning = await isAppReachable(APP_URL);

  if (alreadyRunning) {
    console.log(`[dev:app] detected running app at ${APP_URL}; opening app window only.`);
    const code = await runNpmScript("app:view");
    process.exit(code);
  }

  console.log("[dev:app] no running app detected; starting web + app view.");
  const code = await runNpmScript("_dev:app:stack");
  process.exit(code);
}

main().catch((error) => {
  console.error("[dev:app] failed:", error);
  process.exit(1);
});
