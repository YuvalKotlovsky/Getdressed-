import type { Category } from '../types';
import { partForCategory } from '../tagging/schema';

/** On-device keyword inference from a product/receipt description (Hebrew, English, Spanish as printed by Zara). */
const CAT_RULES: { category: Category; subtype: string; re: RegExp }[] = [
  { category: 'outerwear', subtype: 'מעיל', re: /מעיל|ז׳קט|ג׳קט|בלייזר|קרדיגן|coat|jacket|blazer|parka|trench|abrigo|chaqueta|cazadora|americana/i },
  { category: 'dress', subtype: 'שמלה', re: /שמלה|dress|vestido|mono largo/i },
  { category: 'bottom', subtype: 'מכנסיים', re: /מכנס|ג׳ינס|חצאית|שורט|jeans|trouser|pant|skirt|short|pantal[oó]n|falda|vaquero/i },
  { category: 'shoes', subtype: 'נעליים', re: /נעל|סנדל|מגף|סניקרס|shoe|sneaker|boot|sandal|loafer|zapato|bota|zapatilla/i },
  { category: 'top', subtype: 'חולצה', re: /חולצה|טי שירט|גופיי|סוודר|סווטשירט|שירט|shirt|blouse|top|tee|t-shirt|sweater|jumper|hoodie|camisa|camiseta|jersey|sudadera|blusa/i },
];

export function inferFromName(name: string): { category?: Category; subtype?: string; part?: ReturnType<typeof partForCategory> } {
  if (/legging|טייץ|sport|ספורט|athletic|running/i.test(name)) {
    const category: Category = 'activewear';
    const subtype = /legging|טייץ/i.test(name) ? 'טייץ ספורט' : 'בגד ספורט';
    return { category, subtype, part: partForCategory(category, subtype) };
  }
  for (const r of CAT_RULES) if (r.re.test(name)) return { category: r.category, subtype: r.subtype, part: partForCategory(r.category, r.subtype) };
  return {};
}

const COLOR_WORDS: [string, RegExp][] = [
  ['black', /שחור|black|negro/i],
  ['white', /לבן|white|ecru|ivory|blanco|crudo|שמנת/i],
  ['gray', /אפור|gr[ae]y|gris/i],
  ['beige', /בז׳|בז'|beige|sand|stone|camel|taupe|arena|חול/i],
  ['navy', /כחול כהה|navy|marino/i],
  ['denim', /ג׳ינס|denim|vaquero/i],
  ['brown', /חום|brown|chocolate|marr[oó]n/i],
  ['blue', /כחול|תכלת|blue|azul/i],
  ['red', /אדום|bordeaux|burgundy|red|rojo/i],
  ['green', /ירוק|khaki|green|verde|olive|זית/i],
  ['pink', /ורוד|pink|rosa/i],
  ['yellow', /צהוב|yellow|amarillo|mustard/i],
  ['purple', /סגול|purple|lilac|violet|morado/i],
];
export function colorKeyFromText(text: string): string | undefined {
  return COLOR_WORDS.find(([, re]) => re.test(text))?.[0];
}
