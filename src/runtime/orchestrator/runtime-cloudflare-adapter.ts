import type { RuntimeState } from "./runtime-types";

const QUICK_TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

export function extractQuickTunnelUrl(value: string) {
  const match = value.match(QUICK_TUNNEL_URL_PATTERN);
  return match ? match[0] : null;
}

function getHostnameFromUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

export function applyCloudflareQuickTunnelReadyState(current: RuntimeState, quickTunnelUrl: string) {
  current.cloudflare.publicUrl = quickTunnelUrl;
  current.cloudflare.hostname = getHostnameFromUrl(quickTunnelUrl);
  current.cloudflare.status = "ready";
  current.cloudflare.message = "Temporary Cloudflare URL active. No Cloudflare domain is required.";
  current.cloudflare.requiresUserAction = false;
  current.cloudflare.nextAction = "none";
  current.cloudflare.canRetry = false;
}
