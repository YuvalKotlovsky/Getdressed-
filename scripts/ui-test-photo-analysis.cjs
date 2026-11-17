// DEV-ONLY browser test of the photo-analysis UI. Playwright is NOT a repo dependency: install it in a scratch dir and run with NODE_PATH
// (see server/README.md). Needs: a web build with EXPO_PUBLIC_* pointing at the dev project and EXPO_PUBLIC_RECOGNITION_URL=http://localhost:8787,
// served on :8081; scripts/dev-mock-analysis-server.ts running; SUPABASE_URL, SUPABASE_ANON_KEY, EXPECT_PROJECT_REF, TEST_A_EMAIL, TEST_A_PASSWORD in env.
//
// TEARDOWN IS SCOPED: before the UI run it snapshots the account's rows and storage objects, creates one SENTINEL item with a photo (a stand-in for
// "something that was already there"), runs the UI steps, then deletes ONLY what exists afterwards and did not exist in the snapshot (rows and objects
// created by this run) and verifies every pre-existing row/object, the sentinel included, survived. The sentinel (created by this harness) is removed last.
// It never deletes by name, by folder or "everything of the account". usage rows (ai_usage) cannot be deleted by users; remove them with admin tooling.
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const crypto = require('crypto');

const BASE = 'http://localhost:8081';
const MODE = '/tmp/wmw-mock-mode';
const log = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
if (!URL_ || !process.env.SUPABASE_ANON_KEY || new URL(URL_).hostname !== `${process.env.EXPECT_PROJECT_REF}.supabase.co` || process.env.EXPECT_PROJECT_REF !== 'lenqqdflencoxgpcdlrg') {
  console.log('REFUSING: dev project only (SUPABASE_URL / SUPABASE_ANON_KEY / EXPECT_PROJECT_REF)'); process.exit(1);
}
const BUCKET = 'closet-photos';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 5), Buffer.from([0xff, 0xd9])]);

async function snapshot(sb, uid) {
  const rows = ((await sb.from('wardrobe_items').select('id')).data || []).map((r) => r.id);
  const objects = [];
  const top = (await sb.storage.from(BUCKET).list(uid)).data || [];
  for (const f of top) {
    const inner = (await sb.storage.from(BUCKET).list(`${uid}/${f.name}`)).data || [];
    for (const o of inner) objects.push(`${uid}/${f.name}/${o.name}`);
  }
  return { rows: new Set(rows), objects: new Set(objects) };
}

(async () => {
  const sb = createClient(URL_, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data: auth, error: aerr } = await sb.auth.signInWithPassword({ email: process.env.TEST_A_EMAIL, password: process.env.TEST_A_PASSWORD });
  if (aerr || !auth.user) { console.log('sign-in failed'); process.exit(1); }
  const uid = auth.user.id;

  // 1) sentinel: a pre-existing item with a photo, created by this harness
  const sItem = crypto.randomUUID(), sPhoto = crypto.randomUUID();
  const sPath = `${uid}/${sItem}/${sPhoto}.jpg`;
  const up = await sb.storage.from(BUCKET).upload(sPath, JPEG, { contentType: 'image/jpeg' });
  if (up.error) { console.log('sentinel upload failed: ' + up.error.message); process.exit(1); }
  const ins = await sb.from('wardrobe_items').insert({ id: sItem, data: { name: 'sentinel (ui test harness)' }, photo_path: sPath });
  if (ins.error) { await sb.storage.from(BUCKET).remove([sPath]); console.log('sentinel insert failed: ' + ins.error.message); process.exit(1); }
  log(`sentinel created (row + photo) as the "pre-existing" item`);

  // 2) snapshot AFTER the sentinel exists: everything in it is protected from teardown
  const before = await snapshot(sb, uid);
  log(`snapshot before the UI run: ${before.rows.size} rows, ${before.objects.size} photo objects (all protected)`);

  let uiOk = false;
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 480, height: 900 } });
    const page = await ctx.newPage();
    const reqs = [];
    page.on('request', (r) => { if (r.url().includes(':8787')) reqs.push(r.method() + ' ' + new URL(r.url()).pathname + (r.headers()['authorization'] ? ' [bearer]' : ' [NO AUTH]')); });
    page.on('pageerror', (e) => log('PAGEERROR ' + e.message.slice(0, 120)));
    const imgPath = '/tmp/wmw-ui-test-garment.png';
    { const p2 = await ctx.newPage(); await p2.setContent('<body style="margin:0;background:#222"><div style="width:600px;height:800px;background:linear-gradient(#111,#333)"></div></body>'); await p2.setViewportSize({ width: 600, height: 800 }); await p2.screenshot({ path: imgPath }); await p2.close(); }
    const step = async (name, fn) => { try { await fn(); log('PASS  ' + name); } catch (e) { log('FAIL  ' + name + ' :: ' + String(e.message).split('\n')[0].slice(0, 200)); await page.screenshot({ path: `/tmp/wmw-ui-shot-${name.replace(/\W+/g, '_').slice(0, 30)}.png`, fullPage: true }); throw e; } };
    const addPhoto = async () => {
      await page.getByText('הארון שלי').first().click();
      await page.getByText('הוספת פריט').click();
      await page.getByText('צילום או גלריה').click();
      const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), page.getByText('מהגלריה', { exact: true }).last().click()]);
      await chooser.setFiles(imgPath);
    };
    fs.writeFileSync(MODE, 'ok');
    await step('sign in', async () => {
      await page.goto(BASE);
      await page.getByPlaceholder('אימייל').fill(process.env.TEST_A_EMAIL);
      await page.getByPlaceholder('סיסמה').fill(process.env.TEST_A_PASSWORD);
      await page.getByText('התחברות', { exact: true }).last().click();
      await page.getByText('הארון שלי').first().waitFor({ timeout: 20000 });
    });
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
      await page.waitForTimeout(2500);
      await page.reload();
      await page.getByText('הארון שלי').first().waitFor({ timeout: 20000 });
      await page.getByText('הארון שלי').first().click();
      await page.getByText('שמלה בדיקה UI').first().waitFor({ timeout: 20000 });
      await page.getByText('שמלה בדיקה UI').first().click();
      await page.getByPlaceholder('סוג (אפשר להקליד חופשי)').waitFor();
      // the editor fills its fields in an effect right after opening: poll instead of reading once
      let v = '';
      for (let i = 0; i < 20 && v !== 'שמלת ערב מנוסה'; i++) { v = await page.getByPlaceholder('סוג (אפשר להקליד חופשי)').inputValue(); if (v !== 'שמלת ערב מנוסה') await page.waitForTimeout(250); }
      if (v !== 'שמלת ערב מנוסה') throw new Error('subtype after reload = ' + JSON.stringify(v));
      await page.getByText('ביטול', { exact: true }).last().click();
    });
    fs.writeFileSync(MODE, 'fail');
    await step('analysis fails (mock upstream error): note shown, form usable, manual entry saves', async () => {
      await addPhoto();
      await page.getByText('שליחה וניתוח').click();
      await page.getByText('שירות הזיהוי נכשל או לא זמין כרגע').waitFor({ timeout: 20000 });
      await page.getByText('חולצות', { exact: true }).last().click();
      await page.getByText('לבן', { exact: true }).last().click();
      await page.getByPlaceholder('לדוגמה: חולצת פשתן לבנה').fill('ידני אחרי כשל');
      await page.getByText('שמירה', { exact: true }).last().click();
      await page.getByText('ידני אחרי כשל').first().waitFor({ timeout: 20000 });
    });
    log('requests to the analysis server: ' + JSON.stringify(reqs));
    uiOk = true;
  } catch (e) {
    log('UI RUN ABORTED: ' + String(e.message).split('\n')[0]);
  } finally {
    try { fs.writeFileSync(MODE, 'ok'); } catch {}
    await browser.close().catch(() => {});
    // 3) scoped teardown, always (also after a failure): only what is NEW compared with the snapshot
    await sleep(3000); // let the app's sync queue flush so late uploads are seen
    let removedRows = 0, removedObjs = 0;
    for (let pass = 0; pass < 2; pass++) {
      const after = await snapshot(sb, uid);
      const newRows = [...after.rows].filter((id) => !before.rows.has(id));
      const newObjs = [...after.objects].filter((p) => !before.objects.has(p));
      if (newRows.length) { const d = await sb.from('wardrobe_items').delete().in('id', newRows); if (d.error) log('teardown row delete error: ' + d.error.message); else removedRows += newRows.length; }
      if (newObjs.length) { const d = await sb.storage.from(BUCKET).remove(newObjs); if (d.error) log('teardown object delete error: ' + d.error.message); else removedObjs += newObjs.length; }
      if (!newRows.length && !newObjs.length) break;
      await sleep(1500);
    }
    log(`teardown removed ${removedRows} run-created rows and ${removedObjs} run-created photo objects`);
    // 4) prove nothing pre-existing was touched
    const survivors = await snapshot(sb, uid);
    const lostRows = [...before.rows].filter((id) => !survivors.rows.has(id));
    const lostObjs = [...before.objects].filter((p) => !survivors.objects.has(p));
    const extraRows = [...survivors.rows].filter((id) => !before.rows.has(id));
    const extraObjs = [...survivors.objects].filter((p) => !before.objects.has(p));
    const sentinelOk = survivors.rows.has(sItem) && survivors.objects.has(sPath);
    const teardownOk = lostRows.length === 0 && lostObjs.length === 0 && extraRows.length === 0 && extraObjs.length === 0 && sentinelOk;
    log(`${teardownOk ? 'PASS' : 'FAIL'}  teardown scope: pre-existing item + photo (sentinel) and all ${before.rows.size} rows / ${before.objects.size} objects survived; lost rows ${lostRows.length}, lost objects ${lostObjs.length}, leftovers ${extraRows.length}/${extraObjs.length}`);
    // 5) remove the sentinel the harness itself created
    await sb.from('wardrobe_items').delete().eq('id', sItem);
    await sb.storage.from(BUCKET).remove([sPath]);
    const fin = await snapshot(sb, uid);
    log(`sentinel removed: ${!fin.rows.has(sItem) && !fin.objects.has(sPath)}; rows/objects now ${fin.rows.size}/${fin.objects.size} (before the run, without the sentinel: ${before.rows.size - 1}/${before.objects.size - 1})`);
    process.exit(uiOk && teardownOk ? 0 : 1);
  }
})();
