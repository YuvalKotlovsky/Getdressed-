import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { Buffer } from 'node:buffer';

export type FetchFailure = 'invalid_url' | 'blocked_destination' | 'too_many_redirects' | 'timeout' | 'too_large' | 'network';
export class SafeFetchError extends Error { constructor(public kind: FetchFailure) { super(kind); } }

/** True only for globally routable addresses. */
export function isPublicIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && ip.startsWith('192.0.0.')))) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::' || l === '::1') return false;
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIp(mapped[1]);
    if (/^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith('ff')) return false;
    return true;
  }
  return false;
}

export type Lookup = (host: string) => Promise<string[]>;
export const defaultLookup: Lookup = async (host) => (await dns.lookup(host, { all: true })).map((r) => r.address);

/** Public HTTPS destinations only: https scheme, no credentials, port 443, host is not private/loopback. */
export async function assertPublicUrl(raw: string, lookup: Lookup = defaultLookup): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new SafeFetchError('invalid_url'); }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) throw new SafeFetchError('invalid_url');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (!isPublicIp(host)) throw new SafeFetchError('blocked_destination');
    return u;
  }
  if (!host.includes('.') || /\.(local|internal|localhost|lan)$/i.test(host)) throw new SafeFetchError('blocked_destination');
  let addrs: string[];
  try { addrs = await lookup(host); } catch { throw new SafeFetchError('network'); }
  if (!addrs.length || !addrs.every(isPublicIp)) throw new SafeFetchError('blocked_destination');
  return u;
}

export interface RawResponse { status: number; headers: Record<string, string>; body: Buffer }
export type Transport = (url: URL, opts: { maxBytes: number; timeoutMs: number; accept: string }) => Promise<RawResponse>;

/** Real transport: the socket's DNS lookup is validated too, so a rebinding answer to a private IP is refused. */
export const httpsTransport: Transport = (url, { maxBytes, timeoutMs, accept }) =>
  new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      timeout: timeoutMs,
      headers: { accept, 'user-agent': 'WearMyWeekBot/0.1 (personal wardrobe app; reads public product metadata)', 'accept-language': 'he,en;q=0.8' },
      lookup: (host, _o, cb) => {
        dns.lookup(host, { all: true }).then((r) => {
          const ok = r.filter((x) => isPublicIp(x.address));
          if (!ok.length || ok.length !== r.length) return (cb as any)(new Error('blocked'), '', 4);
          (cb as any)(null, ok[0].address, ok[0].family);
        }, (e) => (cb as any)(e, '', 4));
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); reject(new SafeFetchError('too_large')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, String(v)])), body: Buffer.concat(chunks) }));
      res.on('error', () => reject(new SafeFetchError('network')));
    });
    req.on('timeout', () => { req.destroy(); reject(new SafeFetchError('timeout')); });
    req.on('error', (e) => reject(e instanceof SafeFetchError ? e : new SafeFetchError(String(e.message) === 'blocked' ? 'blocked_destination' : 'network')));
    req.end();
  });

export interface SafeFetchOpts { maxBytes?: number; timeoutMs?: number; accept?: string; maxRedirects?: number; lookup?: Lookup; transport?: Transport }

/** GET with manual redirect handling: EVERY hop is re-validated as a public HTTPS destination. */
export async function safeFetch(rawUrl: string, o: SafeFetchOpts = {}): Promise<RawResponse & { finalUrl: string }> {
  const { maxBytes = 1_500_000, timeoutMs = 8000, accept = 'text/html,*/*;q=0.5', maxRedirects = 4, lookup = defaultLookup, transport = httpsTransport } = o;
  let url = await assertPublicUrl(rawUrl, lookup);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await transport(url, { maxBytes, timeoutMs, accept });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      if (hop === maxRedirects) break;
      url = await assertPublicUrl(new URL(res.headers.location, url).toString(), lookup);
      continue;
    }
    return { ...res, finalUrl: url.toString() };
  }
  throw new SafeFetchError('too_many_redirects');
}
