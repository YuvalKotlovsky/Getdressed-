import { colorKeyFromText, inferFromName } from './infer';
import { zaraProductUrl, type ProductInfo } from './parseProduct';
import type { Category, Part } from '../types';

export interface ReceiptLine {
  id: string;
  raw: string; // the original line as read (never stored with the wardrobe)
  description: string;
  quantity: number;
  reference?: string; // e.g. 2183/151
  variant?: string; // size/variant code if printed
  price?: string;
}

const SKIP = /סה["״']?כ|סהכ|סכום|total|subtotal|מע["״']?מ|vat|visa|mastercard|isracard|amex|אשראי|מזומן|cash|עודף|change|card|כרטיס|תשלום|payment|תודה|thank|קבלה|חשבונית|invoice|receipt|טלפון|tel[:.\s]|www\.|https?:|סניף|branch|cashier|קופאי|transaction|עסקה|אישור|approval|hp\b|ח\.?פ|מס['׳]? ?עוסק/i;
const DATE = /\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/;
const REF = /(\d{4})\s*\/\s*(\d{3})(?:\s*\/\s*(\d{2,3}))?/;
const PRICE = /(\d{1,4}[.,]\d{2})\s*(?:₪|nis|ils)?\s*$/i;

export function parseReceiptText(text: string): { store?: string; lines: ReceiptLine[] } {
  const store = /zara/i.test(text) ? 'zara' : undefined;
  const lines: ReceiptLine[] = [];
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((raw, idx) => {
    if (SKIP.test(raw) || /^\d{9,}$/.test(raw.replace(/\s/g, ''))) return;
    if (DATE.test(raw) && !REF.test(raw)) return;
    const ref = raw.match(REF);
    let work = raw;
    let reference: string | undefined, variant: string | undefined;
    if (ref) { reference = `${ref[1]}/${ref[2]}`; variant = ref[3]; work = work.replace(ref[0], ' '); }
    const price = work.match(PRICE)?.[1];
    if (price) work = work.replace(PRICE, ' ');
    let quantity = 1;
    const qm = work.match(/(?:^|\s)(\d{1,2})\s*[xX×]\s|\s[xX×]\s*(\d{1,2})(?:\s|$)|\s(\d{1,2})\s*$/);
    if (qm) { quantity = Number(qm[1] ?? qm[2] ?? qm[3]); work = work.replace(qm[0], ' '); }
    const description = work.replace(/\d+[.,]\d{2}/g, ' ').replace(/^[\s\d.\-–:*#]+/, '').replace(/\s{2,}/g, ' ').trim();
    const letters = (description.match(/[A-Za-z֐-׿]/g) ?? []).length;
    if (!reference && !(letters >= 4 && (price || qm))) return;
    lines.push({ id: `l${idx}`, raw, description, quantity: Math.max(1, Math.min(quantity, 20)), reference, variant, price });
  });
  return { store, lines };
}

/** Stable fingerprint to warn about scanning the same receipt twice. Only this hash is kept, never the receipt. */
export function receiptFingerprint(lines: ReceiptLine[]): string {
  const norm = lines.map((l) => `${l.reference ?? ''}|${l.description.toLowerCase().replace(/\s+/g, ' ')}|${l.quantity}`).sort().join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) { h ^= norm.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0') + norm.length.toString(16);
}

export type MatchStatus = 'matched' | 'uncertain' | 'unmatched';
export interface LineMatch {
  status: MatchStatus;
  note: string;
  url?: string;
  product?: ProductInfo;
  imageBase64?: string;
  mediaType?: string;
  /** tags to prefill (from the product page, else from the printed description) */
  suggestion: { name: string; category?: Category; subtype?: string; part?: Part; color?: string };
}

export const candidateUrl = (line: ReceiptLine, store?: string): string | undefined =>
  store === 'zara' && line.reference ? zaraProductUrl(line.reference) : undefined;

/**
 * Matched = a public product page whose reference equals the receipt reference.
 * Uncertain = we have something usable (description, or a page without a confirming reference).
 * Unmatched = nothing usable.
 */
export function classifyMatch(line: ReceiptLine, page: { status: string; product?: ProductInfo; finalUrl?: string; imageBase64?: string; mediaType?: string } | null): LineMatch {
  const fromDesc = inferFromName(line.description);
  const descColor = colorKeyFromText(line.description);
  const base = { name: line.description || line.reference || 'פריט מקבלה', ...fromDesc, color: descColor };
  const p = page?.product;
  if (p && p.name && (page?.status === 'ok' || page?.status === 'partial')) {
    const same = !!line.reference && !!p.reference && p.reference.replace(/\s/g, '').includes(line.reference.replace(/\s/g, ''));
    const suggestion = { name: p.name, category: p.category ?? fromDesc.category, subtype: p.subtype ?? fromDesc.subtype, part: p.part ?? fromDesc.part, color: p.color ?? descColor };
    return {
      status: same ? 'matched' : 'uncertain',
      note: same ? 'נמצא דף מוצר עם אותו מק״ט' : 'נמצא דף מוצר אבל המק״ט לא אושר, כדאי לבדוק צבע ווריאנט',
      url: page?.finalUrl, product: p, imageBase64: page?.imageBase64, mediaType: page?.mediaType, suggestion,
    };
  }
  if (line.description.length >= 3) {
    const why = !line.reference ? 'אין מק״ט בשורה' : page?.status === 'not_found' ? 'דף המוצר הוסר' : page?.status === 'blocked' ? 'דף המוצר חסום לקריאה' : 'לא נמצא דף מוצר';
    return { status: 'uncertain', note: `${why}. התגיות הוצעו לפי התיאור בקבלה`, suggestion: base };
  }
  return { status: 'unmatched', note: 'לא הצלחנו להבין את השורה. אפשר לצרף תמונה או קישור, או לדלג', suggestion: base };
}
