import { parseProductHtml, type ProductInfo } from '../src/import/parseProduct';
import { SafeFetchError, safeFetch, type SafeFetchOpts } from './safeFetch';

export type ProductStatus = 'ok' | 'partial' | 'blocked' | 'not_found' | 'invalid_url' | 'error';
export interface ProductResult {
  status: ProductStatus;
  product?: ProductInfo;
  imageBase64?: string;
  mediaType?: string;
  finalUrl?: string;
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const looksBlocked = (html: string) => /access denied|captcha|are you a robot|px-captcha|enable javascript and cookies|request blocked/i.test(html.slice(0, 6000));

/** Fetches a public product page and reads its metadata + main image. Never throws. */
export async function fetchProduct(url: string, o: SafeFetchOpts = {}): Promise<ProductResult> {
  let page;
  try {
    page = await safeFetch(url, o);
  } catch (e) {
    const k = e instanceof SafeFetchError ? e.kind : 'network';
    return { status: k === 'invalid_url' || k === 'blocked_destination' ? 'invalid_url' : 'error' };
  }
  if (page.status === 404 || page.status === 410) return { status: 'not_found', finalUrl: page.finalUrl };
  const html = page.body.toString('utf8');
  if (page.status === 401 || page.status === 403 || page.status === 429 || page.status === 503 || looksBlocked(html)) return { status: 'blocked', finalUrl: page.finalUrl };
  if (page.status >= 400) return { status: 'error', finalUrl: page.finalUrl };

  const product = parseProductHtml(html, page.finalUrl);
  if (!product.name && !product.imageUrl) return { status: 'blocked', finalUrl: page.finalUrl }; // JS-only/empty shell
  const out: ProductResult = { status: 'partial', product, finalUrl: page.finalUrl };
  if (product.imageUrl) {
    try {
      const img = await safeFetch(product.imageUrl, { ...o, maxBytes: 3_000_000, accept: 'image/jpeg,image/png,image/webp' });
      const type = (img.headers['content-type'] ?? '').split(';')[0].trim();
      if (img.status === 200 && IMAGE_TYPES.has(type)) { out.imageBase64 = img.body.toString('base64'); out.mediaType = type; }
    } catch { /* image is optional */ }
  }
  if (product.name && out.imageBase64) out.status = 'ok';
  return out;
}
