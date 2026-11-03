/**
 * Run on a computer/CI with real network access to check the REAL services (the cloud sandbox cannot reach them):
 *   ANTHROPIC_API_KEY=... npx tsx scripts/verify-services.ts [--city tlv] [--product <https url>] photo1.jpg photo2.jpg
 * Photos are sent to the Anthropic API exactly like the app's server would. Do not use private photos you don't want uploaded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { analyze } from '../server/index';
import { fetchProduct } from '../server/product';
import { CITIES, cityById, fetchForecast, makeWeatherSource } from '../src/weather/weather';

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const cityId = opt('--city') ?? 'tlv';
const productUrl = opt('--product');
const photos = args;

(async () => {
  const city = cityById(cityId);
  const f = await fetchForecast(city);
  console.log(`\n[weather] ${city.name}: ${f ? `LIVE forecast, ${f.times.length} hourly points` : 'forecast UNREACHABLE (app would use the seasonal estimate)'}`);
  if (f) {
    const src = makeWeatherSource({ city, forecast: f });
    for (const h of [10, 18]) { const d = new Date(); d.setHours(h, 0, 0, 0); const w = src(d.getTime()); console.log(`  today ${h}:00 -> ${w.temp}° ${w.band} (${w.source})`); }
  }
  console.log('  cities:', CITIES.map((c) => c.id).join(', '));

  if (productUrl) {
    const r = await fetchProduct(productUrl);
    console.log(`\n[product] ${productUrl}\n  status=${r.status} name=${r.product?.name} color=${r.product?.colorText} ref=${r.product?.reference} image=${r.imageBase64 ? 'yes' : 'no'}`);
  }

  for (const file of photos) {
    const b64 = fs.readFileSync(file).toString('base64');
    const mediaType = /\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg';
    const out = await analyze({ image: b64, mediaType }, { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.RECOGNITION_MODEL });
    console.log(`\n[recognition] ${path.basename(file)} -> HTTP ${out.status}\n  ${JSON.stringify(out.json)}`);
  }
  if (!photos.length) console.log('\n[recognition] no photos given');
})();
