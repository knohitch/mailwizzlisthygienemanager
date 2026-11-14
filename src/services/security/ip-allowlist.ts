import net from 'node:net';
import { getEnv } from '@/lib/env';

function normalizeIp(rawIp: string): string {
  const trimmed = rawIp.trim();
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  return trimmed;
}

export function isIpAllowedByEnv(rawIp: string): {
  allowed: boolean;
  configured: boolean;
  normalizedIp: string;
} {
  const env = getEnv();
  const normalizedIp = normalizeIp(rawIp);
  const ipEntries = (env.ALLOWED_ADMIN_IPS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const cidrEntries = (env.ALLOWED_ADMIN_CIDRS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (ipEntries.length === 0 && cidrEntries.length === 0) {
    return { allowed: true, configured: false, normalizedIp };
  }

  const blockList = new net.BlockList();
  for (const entry of ipEntries) {
    const clean = normalizeIp(entry);
    const ver = net.isIP(clean);
    if (ver === 4) blockList.addAddress(clean, 'ipv4');
    else if (ver === 6) blockList.addAddress(clean, 'ipv6');
  }

  for (const cidr of cidrEntries) {
    const [addrRaw, prefixRaw] = cidr.split('/');
    const addr = normalizeIp(addrRaw ?? '');
    const prefix = Number(prefixRaw);
    const ver = net.isIP(addr);
    if (ver === 4 && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32) {
      blockList.addSubnet(addr, prefix, 'ipv4');
    } else if (ver === 6 && Number.isInteger(prefix) && prefix >= 0 && prefix <= 128) {
      blockList.addSubnet(addr, prefix, 'ipv6');
    }
  }

  const family = net.isIP(normalizedIp);
  if (family === 0) {
    return { allowed: false, configured: true, normalizedIp };
  }

  return {
    allowed: blockList.check(normalizedIp, family === 4 ? 'ipv4' : 'ipv6'),
    configured: true,
    normalizedIp,
  };
}
