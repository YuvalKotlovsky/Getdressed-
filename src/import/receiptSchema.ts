import type { ReceiptLine } from './receipt';

/** Instruction for the vision model when the receipt text cannot be read on-device. Extraction only. */
export const RECEIPT_PROMPT = `You read a CROPPED photo of a shopping receipt that should show ONLY the item lines. Extract the purchased clothing lines.
Reply with JSON only: {"store":"zara|other|unknown","lines":[{"description":"as printed","quantity":1,"reference":"NNNN/NNN or empty","variant":"size/variant code or empty","price":"1234.56 or empty"}]}
Do not include totals, payment, card, VAT, cashier, address, phone, date or barcode information. If you see such data, ignore it and never repeat it. If no item lines are readable, return {"store":"unknown","lines":[]}.`;

export function normalizeReceipt(raw: unknown): { store?: string; lines: ReceiptLine[] } | null {
  const r = raw as any;
  if (!r || !Array.isArray(r.lines)) return null;
  const lines: ReceiptLine[] = r.lines.slice(0, 40).map((l: any, i: number) => {
    const description = String(l?.description ?? '').trim().slice(0, 80);
    const reference = typeof l?.reference === 'string' && /^\d{4}\/\d{3}$/.test(l.reference.trim()) ? l.reference.trim() : undefined;
    const quantity = Math.max(1, Math.min(20, Math.round(Number(l?.quantity) || 1)));
    return { id: `l${i}`, raw: [description, reference].filter(Boolean).join(' '), description, quantity, reference, variant: l?.variant ? String(l.variant).slice(0, 8) : undefined, price: l?.price ? String(l.price).slice(0, 10) : undefined };
  }).filter((l: ReceiptLine) => l.description || l.reference);
  return { store: r.store === 'zara' ? 'zara' : undefined, lines };
}
