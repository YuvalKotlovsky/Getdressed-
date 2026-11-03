import { RECOGNITION_URL } from '../tagging/recognition';
import type { ProductResult } from '../../server/product';
import type { ReceiptLine } from './receipt';

export const serverConfigured = !!RECOGNITION_URL;

export class ServerError extends Error { constructor(public kind: 'not_configured' | 'network' | 'server') { super(kind); } }

async function post(path: string, body: unknown, timeoutMs: number): Promise<any> {
  if (!RECOGNITION_URL) throw new ServerError('not_configured');
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`${RECOGNITION_URL.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl?.signal });
    const json = await res.json().catch(() => null);
    if (!json) throw new ServerError('server');
    return json;
  } catch (e) {
    throw e instanceof ServerError ? e : new ServerError('network');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The server reads the public product page (https only) and returns name/image/colour/reference. */
export const fetchProductViaServer = (url: string): Promise<ProductResult> => post('/product', { url }, 25000);

/** Receipt photo -> item lines. Only after the user cropped and consented. */
export async function extractReceiptViaServer(base64: string, mediaType: string): Promise<{ store?: string; lines: ReceiptLine[] }> {
  const json = await post('/receipt', { image: base64, mediaType }, 40000);
  if (json.error || !Array.isArray(json.lines)) throw new ServerError('server');
  return json;
}

export const storeFromUrl = (url: string): string => {
  try { const h = new URL(url).hostname.replace(/^www\./, ''); return /zara\.com$/.test(h) ? 'zara' : h; } catch { return ''; }
};
