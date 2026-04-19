import { useEffect, useState } from "react";
import {
  MEDIAMTX_CONTROL_API_URL,
  MEDIAMTX_HLS_MUXERS_API_URL,
  normalizeMp3ListenerCount,
  parseMediaMtxHlsMuxerCount,
  parseMediaMtxPath,
  parseMp3HealthListenerCount,
  RELAY_METRICS_POLL_MS,
} from "@/src/lib/relay-metrics";

interface RelayMetricsInput {
  relayRunning: boolean;
  ingestRunning: boolean;
  relayPath: string;
  mp3HealthUrl: string | null;
  mp3HealthDevProxyUrl: string | null;
}

/**
 * Polls MediaMTX path/HLS APIs and the MP3 health endpoint on a fixed interval.
 * Resets to null when the relay is not running.
 */
export function useRelayMetrics({
  relayRunning,
  ingestRunning,
  relayPath,
  mp3HealthUrl,
  mp3HealthDevProxyUrl,
}: RelayMetricsInput): RelayMetrics | null {
  const [relayMetrics, setRelayMetrics] = useState<RelayMetrics | null>(null);

  useEffect(() => {
    if (!relayRunning) {
      setRelayMetrics(null);
      return;
    }

    let alive = true;

    async function poll() {
      // If proxy is available, do not fall back to direct cross-origin health checks.
      const mp3Candidates = (
        typeof mp3HealthDevProxyUrl === "string" && mp3HealthDevProxyUrl.length > 0
          ? [mp3HealthDevProxyUrl]
          : [mp3HealthUrl]
      ).filter((c): c is string => typeof c === "string" && c.length > 0);

      const mp3Request = (async () => {
        for (const candidate of mp3Candidates) {
          try {
            const res = await fetch(candidate, { cache: "no-store" });
            if (!res.ok) continue;
            const parsed = parseMp3HealthListenerCount(await res.json());
            if (parsed) return parsed;
          } catch {
            // try next candidate
          }
        }
        return null;
      })();

      const pathRequest = fetch(MEDIAMTX_CONTROL_API_URL, { cache: "no-store" })
        .then(async (res) => (res.ok ? parseMediaMtxPath(await res.json(), relayPath) : null))
        .catch(() => null);

      const hlsRequest = fetch(MEDIAMTX_HLS_MUXERS_API_URL, { cache: "no-store" })
        .then(async (res) => (res.ok ? parseMediaMtxHlsMuxerCount(await res.json()) : 0))
        .catch(() => 0);

      const [helperStatus, relayStatus, hlsMuxerCount] = await Promise.all([
        mp3Request,
        pathRequest,
        hlsRequest,
      ]);

      if (!alive) return;

      const mp3ListenerCount = normalizeMp3ListenerCount(helperStatus, ingestRunning);
      const hlsListenerCount = Math.max(0, hlsMuxerCount);
      const relayListenerCount = relayStatus?.listenerCount ?? 0;

      setRelayMetrics({
        listenerCount: Math.max(mp3ListenerCount, hlsListenerCount, relayListenerCount),
        relayPathReady: relayStatus?.ready ?? false,
        relayBytesReceived: relayStatus?.bytesReceived ?? 0,
        mp3ListenerCount,
        hlsListenerCount,
      });
    }

    void poll();
    const timer = window.setInterval(() => { void poll(); }, RELAY_METRICS_POLL_MS);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [ingestRunning, mp3HealthDevProxyUrl, mp3HealthUrl, relayPath, relayRunning]);

  return relayMetrics;
}
