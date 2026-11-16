// DEV-ONLY browser test of the photo-analysis UI (Playwright is NOT a repo dependency: install it in a scratch dir and run with NODE_PATH, see server/README.md).
// Needs: web build with EXPO_PUBLIC_* pointing at the dev project and EXPO_PUBLIC_RECOGNITION_URL=http://localhost:8787 served on :8081, scripts/dev-mock-analysis-server.ts running, TEST_A_* in env. Writes /tmp/wmw-mock-mode. Leaves test items in account A: remove them afterwards.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8081';
const shot = (page, n) => page.screenshot({ path: `/tmp/wmw-ui-shot-${n}.png`, fullPage: true });
const log = (m) => console.log(m);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 480, height: 900 } });
  const page = await ctx.newPage();
  const reqs = [];
  page.on('request', (r) => { if (r.url().includes(':8787')) reqs.push(r.method() + ' ' + new URL(r.url()).pathname + (r.headers()['authorization'] ? ' [bearer]' : ' [NO AUTH]')); });
  page.on('pageerror', (e) => log('PAGEERROR ' + e.message.slice(0, 120)));
  // test image: a plain PNG
  const imgPath = `/tmp/wmw-ui-test-garment.png`;
  { const p2 = await ctx.newPage(); await p2.setContent('<body style="margin:0;background:#222"><div style="width:600px;height:800px;background:linear-gradient(#111,#333)"></div></body>'); await p2.setViewportSize({ width: 600, height: 800 }); await p2.screenshot({ path: imgPath }); await p2.close(); }

  const step = async (name, fn) => { try { await fn(); log('PASS  ' + name); } catch (e) { log('FAIL  ' + name + ' :: ' + String(e.message).split('\n')[0].slice(0, 200)); await shot(page, name.replace(/\W+/g, '_').slice(0, 30)); throw e; } };

  await step('sign in', async () => {
    await page.goto(BASE);
    await page.getByPlaceholder('אימייל').fill(process.env.TEST_A_EMAIL);
    await page.getByPlaceholder('סיסמה').fill(process.env.TEST_A_PASSWORD);
    await page.getByText('התחברות', { exact: true }).last().click();
    await page.getByText('הארון שלי').first().waitFor({ timeout: 20000 });
  });
  const addPhoto = async () => {
    await page.getByText('הארון שלי').first().click();
    await page.getByText('הוספת פריט').click();
    await page.getByText('צילום או גלריה').click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), page.getByText('מהגלריה', { exact: true }).last().click()]);
    await chooser.setFiles(imgPath);
  };
  await step('select photo -> consent panel appears', async () => { await addPhoto(); await page.getByText('ניתוח אוטומטי של התמונה').waitFor({ timeout: 20000 }); });
  await step('analysis (mocked provider) fills suggested tags; uncertain fields flagged', async () => {
    await page.getByText('שליחה וניתוח').click();
    await page.getByText('שמלת מידי').first().waitFor({ timeout: 20000 });
    const flags = await page.getByText('לבדיקה', { exact: true }).count();
    if (flags < 2) throw new Error('expected flagged fields, got ' + flags);
  });
  await step('edit suggested tags (subtype + name), then save', async () => {
    await page.getByPlaceholder('סוג (אפשר להקליד חופשי)').fill('שמלת ערב מנוסה');
    await page.getByPlaceholder('לדוגמה: חולצת פשתן לבנה').fill('שמלה בדיקה UI');
    await page.getByText('שמירה', { exact: true }).last().click();
    await page.getByText('שמלה בדיקה UI').first().waitFor({ timeout: 20000 });
  });
  await step('refresh: the edited item (not the raw suggestion) is still there', async () => {
    await page.waitForTimeout(2500); // let sync flush
    await page.reload();
    await page.getByText('הארון שלי').first().waitFor({ timeout: 20000 });
    await page.getByText('הארון שלי').first().click();
    await page.getByText('שמלה בדיקה UI').first().waitFor({ timeout: 20000 });
    await page.getByText('שמלה בדיקה UI').first().click();
    await page.getByPlaceholder('סוג (אפשר להקליד חופשי)').waitFor();
    const v = await page.getByPlaceholder('סוג (אפשר להקליד חופשי)').inputValue();
    if (v !== 'שמלת ערב מנוסה') throw new Error('subtype after reload = ' + v);
    await page.getByText('ביטול', { exact: true }).last().click();
  });
  // failure -> manual entry
  fs.writeFileSync('/tmp/wmw-mock-mode', 'fail');
  await step('analysis fails (mock upstream error): note shown, form usable, manual entry saves', async () => {
    await addPhoto();
    await page.getByText('שליחה וניתוח').click();
    await page.getByText('שירות הזיהוי נכשל או לא זמין כרגע').waitFor({ timeout: 20000 });
    // choose category + colour manually
    await page.getByText('חולצות', { exact: true }).last().click();
    await page.getByText('לבן', { exact: true }).last().click();
    await page.getByPlaceholder('לדוגמה: חולצת פשתן לבנה').fill('ידני אחרי כשל');
    await page.getByText('שמירה', { exact: true }).last().click();
    await page.getByText('ידני אחרי כשל').first().waitFor({ timeout: 20000 });
  });
  fs.writeFileSync('/tmp/wmw-mock-mode', 'ok');
  log('requests to the analysis server: ' + JSON.stringify(reqs));
  await browser.close();
})().catch((e) => { console.log('ABORTED: ' + String(e.message).split('\n')[0]); process.exit(1); });
