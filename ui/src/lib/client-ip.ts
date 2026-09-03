import { isIP } from "node:net";

// Header presence is not proof of origin. Trust is asserted by deployment.
export function clientRateLimitKey(headers: Headers, trustCloudflare: boolean): string | null {
  if (!trustCloudflare) return "shared";
  const ip = headers.get("cf-connecting-ip")?.trim();
  if (!ip) return null;
  const family = isIP(ip);
  if (family === 4) return `ip:${ip}`;
  if (family !== 6) return null;

  try {
    const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    // IPv4-mapped IPv6 must share the IPv4 bucket, including hexadecimal forms.
    const mapped = normalized.match(/^::ffff:([\da-f]+):([\da-f]+)$/);
    if (mapped) {
      const high = parseInt(mapped[1], 16);
      const low = parseInt(mapped[2], 16);
      return `ip:${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
    }
    return `ip:${normalized}`;
  } catch {
    return null;
  }
}
