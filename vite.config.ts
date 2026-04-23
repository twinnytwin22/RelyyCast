import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as { version: string };

function mp3HealthProxyPlugin() {
  return {
    name: "relyy-mp3-health-proxy",
    configureServer(server: {
      middlewares: {
        use: (path: string, handler: (req: { url?: string }, res: {
          statusCode: number;
          setHeader: (name: string, value: string) => void;
          end: (body?: string) => void;
        }) => Promise<void>) => void;
      };
    }) {
      server.middlewares.use("/__relyy/mp3-health", async (req, res) => {
        const requestUrl = new URL(req.url ?? "", "http://localhost");
        const originCandidate = requestUrl.searchParams.get("origin") ?? "http://127.0.0.1:4850";

        let targetOrigin = "";
        try {
          const parsedOrigin = new URL(originCandidate);
          if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
            throw new Error("unsupported protocol");
          }
          targetOrigin = parsedOrigin.origin;
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify({ ok: false, error: "invalid origin" }));
          return;
        }

        const targetHealthUrl = `${targetOrigin}/health`;
        try {
          const response = await fetch(targetHealthUrl, {
            headers: {
              Accept: "application/json",
            },
          });
          const payload = await response.text();

          res.statusCode = response.status;
          res.setHeader(
            "Content-Type",
            response.headers.get("content-type") ?? "application/json; charset=utf-8",
          );
          res.setHeader("Cache-Control", "no-store");
          res.end(payload);
        } catch {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify({ ok: false, error: "proxy fetch failed" }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), mp3HealthProxyPlugin()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  build: {
    outDir: "app",
    emptyOutDir: true,
  },
});
