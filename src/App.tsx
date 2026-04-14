import { useEffect } from "react";
import { StationConsole } from "@/components/station-console";
import { ensureRuntimeOrchestrationStarted } from "./runtime/neutralino-runtime-orchestrator";

const REDIRECT_PATHS = new Set(["/login", "/stations"]);

export default function App() {
  useEffect(() => {
    if (REDIRECT_PATHS.has(window.location.pathname)) {
      window.history.replaceState({}, "", "/");
    }
  }, []);

  useEffect(() => {
    void ensureRuntimeOrchestrationStarted();
  }, []);

  return <StationConsole />;
}
