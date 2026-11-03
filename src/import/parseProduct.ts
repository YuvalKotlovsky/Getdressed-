import { colorKeyFromText, inferFromName } from './infer';
import type { Category, Part } from '../types';

export interface ProductInfo {
  name?: string;
  imageUrl?: string;
  color?: string; // COLORS key when recognised
  colorText?: string; // as printed on the page
  reference?: string;
  brand?: string;
  category?: Category;
  subtype?: string;
  part?: Part;
  origin: 'jsonld' | 'meta' | 'none';
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").trim();

function metaContent(html: string, key: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  const c = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return c ? decode(c) : undefined;
}

function* walk(node: any): Generator<any> {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  if (node && typeof node === 'object') {
    yield node;
    if (node['@graph']) yield* walk(node['@graph']);
  }
}
const isProduct = (n: any) => { const t = n?.['@type']; return t === 'Product' || (Array.isArray(t) && t.includes('Product')); };
const firstString = (v: any): string | undefined => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return firstString(v[0]);
  if (v && typeof v === 'object') return firstString(v.url ?? v.contentUrl ?? v.name);
  return undefined;
};

/** Zara reference from a product URL: …-p02183151.html -> 2183/151 (style/colour). */
export function zaraRefFromUrl(url: string): string | undefined {
  const m = url.match(/-p(\d{8})\.html/i);
  return m ? `${m[1].slice(1, 5)}/${m[1].slice(5, 8)}` : undefined;
}
/** Candidate public Zara page for a reference like 2183/151. */
export const zaraProductUrl = (ref: string, region = 'il/he'): string | undefined => {
  const m = ref.match(/^(\d{4})\/(\d{3})$/);
  return m ? `https://www.zara.com/${region}/-p0${m[1]}${m[2]}.html` : undefined;
};

function absolute(url: string | undefined, base: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url, base);
    return u.protocol === 'https:' ? u.toString() : undefined;
  } catch { return undefined; }
}

/** Reads public product metadata (JSON-LD Product first, then Open Graph). Pure, no network. */
export function parseProductHtml(html: string, pageUrl: string): ProductInfo {
  let name: string | undefined, image: string | undefined, colorText: string | undefined, reference: string | undefined, brand: string | undefined;
  let origin: ProductInfo['origin'] = 'none';

  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let json: any;
    try { json = JSON.parse(b[1]); } catch { continue; }
    for (const n of walk(json)) {
      if (!isProduct(n)) continue;
      name = firstString(n.name) ?? name;
      image = firstString(n.image) ?? image;
      colorText = firstString(n.color) ?? colorText;
      reference = firstString(n.sku) ?? firstString(n.mpn) ?? firstString(n.productID) ?? reference;
      brand = firstString(n.brand) ?? brand;
      origin = 'jsonld';
    }
    if (origin === 'jsonld') break;
  }
  if (!name) {
    name = metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title') ?? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '') ?? undefined;
    if (name) origin = 'meta';
  }
  image = image ?? metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image');
  colorText = colorText ?? metaContent(html, 'product:color');
  brand = brand ?? metaContent(html, 'og:site_name');
  if (!reference && /zara\.com/i.test(pageUrl)) reference = zaraRefFromUrl(pageUrl);
  name = name ? decode(name).replace(/\s+\|\s+ZARA.*$/i, '').slice(0, 120) : undefined;

  const inferred = name ? inferFromName(name) : {};
  const colorSource = [colorText, name].filter(Boolean).join(' ');
  return {
    name: name || undefined,
    imageUrl: absolute(image, pageUrl),
    colorText,
    color: colorSource ? colorKeyFromText(colorSource) : undefined,
    reference: reference?.slice(0, 40),
    brand: brand?.slice(0, 40),
    origin: name || image ? origin : 'none',
    ...inferred,
  };
}
