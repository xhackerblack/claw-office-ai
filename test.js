#!/usr/bin/env node
/**
 * ═══ Claw Office AI v3.3 — نظام الاختبار الشامل ═══
 * يفحص: API + الواجهة + أوامر البوت + الأمان + التذكيرات + صفحة العملاء
 * التشغيل: node test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_PORT = 8399;
const BASE = `http://localhost:${TEST_PORT}`;
const ROOT = __dirname;

let passed = 0, failed = 0;
const failures = [];
const results = { api: [], ui: [], bot: [], sync: [] };

function ok(group, name, cond, detail = '') {
  const pass = !!cond;
  if (pass) passed++; else { failed++; failures.push({ group, name, detail }); }
  results[group].push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} [${group}] ${name}${detail && !pass ? ' — ' + detail : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function req(pathname, method = 'GET', body) {
  const r = await fetch(BASE + pathname, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch (e) {}
  return { status: r.status, json, headers: r.headers };
}

// ═══ 1) الواجهة ═══
function testUI() {
  console.log('\n━━━ 🖥 فحص عناصر الواجهة ━━━');
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const appjs = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');

  const ids = new Set();
  for (const m of html.matchAll(/id="([^"]+)"/g)) ids.add(m[1]);
  const usedIds = new Set();
  for (const m of appjs.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)) usedIds.add(m[1]);
  for (const m of appjs.matchAll(/\$\$\('#([a-zA-Z0-9_-]+)/g)) usedIds.add(m[1]);
  const missing = [...usedIds].filter(id => !ids.has(id));
  ok('ui', 'كل المعرفات المستخدمة في app.js موجودة في HTML', missing.length === 0, 'مفقود: ' + missing.join(', '));

  const screens = new Set();
  for (const m of html.matchAll(/<section id="(screen-[^"]+)"/g)) screens.add(m[1]);
  const gos = new Set();
  for (const m of html.matchAll(/data-go="([^"]+)"/g)) gos.add(m[1]);
  const badGo = [...gos].filter(g => !screens.has(g));
  ok('ui', 'كل أزرار data-go تشير إلى شاشات موجودة', badGo.length === 0, 'خاطئ: ' + badGo.join(', '));

  ok('ui', 'الشريط السفلي يحتوي 5 أزرار', (html.match(/class="nav-btn/g) || []).length === 5);

  const idArr = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const dupes = idArr.filter((v, i) => idArr.indexOf(v) !== i);
  ok('ui', 'لا معرفات مكررة', dupes.length === 0, 'مكرر: ' + [...new Set(dupes)].join(', '));

  ok('ui', 'RTL والعربية', html.includes('dir="rtl"') && html.includes('lang="ar"'));
  ok('ui', 'خط Cairo غير حاجب', html.includes('media="print"') && html.includes('Cairo'));

  for (const s of screens) {
    const re = new RegExp(`<section id="${s}"[^>]*>([\\s\\S]*?)</section>`);
    const body = (html.match(re) || [])[1] || '';
    ok('ui', `الشاشة ${s} غير فارغة`, body.trim().length > 50);
  }

  const jsClasses = new Set();
  for (const m of appjs.matchAll(/class="([a-zA-Z0-9_ -]+)"/g)) {
    m[1].split(/\s+/).forEach(c => { if (/^[a-z][a-z0-9-]+$/.test(c)) jsClasses.add(c); });
  }
  const missingCss = [...jsClasses].filter(c => !css.includes('.' + c));
  ok('ui', 'كل الأصناف المولّدة من JS لها أنماط CSS', missingCss.length === 0, 'بدون نمط: ' + missingCss.join(', '));

  // لا بيانات تجريبية
  ok('ui', '⚠ لا بيانات تجريبية (سارة العلوي/أحمد العلوي)', !html.includes('سارة العلوي') && !html.includes('أحمد العلوي') && !html.includes('AB123456'));
  // بطاقات جديدة
  ok('ui', 'بطاقة رمز الأمان موجودة', html.includes('access-token') && html.includes('token-regen'));
  ok('ui', 'بطاقة مدة التذكير موجودة', html.includes('rem-range') && html.includes('rem-save'));
  ok('ui', 'زر مسح المستند OCR موجود', html.includes('doc-file') && html.includes('upload-doc'));
  // صفحة العملاء v3.3
  ok('ui', '🧾 صفحة العملاء موجودة في التنقل', html.includes('screen-clients') && html.includes('clients-grid'));
  ok('ui', '🧾 زر العملاء في الشريط السفلي', /<button class="nav-btn" data-go="screen-clients">/.test(html));
  ok('ui', '🧾 بطاقة التعديل موجودة (ce-save/ce-cancel)', html.includes('client-edit-card') && html.includes('ce-save') && html.includes('ce-cancel'));
  ok('ui', '🧾 بحث العملاء موجود', html.includes('client-search'));
  ok('ui', '🧾 منطق التعديل والحذف في app.js', appjs.includes('editClient') && appjs.includes('deleteClient') && appjs.includes('/api/clients/update'));

  // Kimi v3.3
  const srvSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  ok('ui', '🌙 الخادم يدعم /chat و /endchat ووضع aiChat', srvSrc.includes("case '/chat'") && srvSrc.includes("case '/endchat'") && srvSrc.includes('aiChat'));
  ok('ui', '🌙 زر اختبار Kimi يستعمل /api/kimi/test', appjs.includes("'/api/kimi/test'"));
  ok('ui', '🌙 نموذج moonshot-v1-8k هو الافتراضي', html.includes('value="moonshot-v1-8k" selected') && srvSrc.includes("DEFAULT_KIMI_MODEL = 'moonshot-v1-8k'"));

  // XSS
  ok('ui', '⚠ أمان: esc() مستعملة في الحقن', appjs.includes('function esc(') && !/insertAdjacentHTML\('beforeend', `<div class="msg me">\$\{inp\.value\}/.test(appjs));
  ok('ui', '⚠ البحث: escRe يحمي RegExp', appjs.includes('escRe') && !appjs.includes('new RegExp(q,'));
}

// ═══ 2) API ═══
async function testAPI() {
  console.log('\n━━━ 🌐 فحص واجهات API ━━━');

  let r = await req('/api/version');
  ok('api', '/api/version', r.status === 200 && r.json?.version === '3.3', JSON.stringify(r.json));

  r = await req('/');
  ok('api', 'الصفحة الرئيسية (200)', r.status === 200);

  r = await req('/styles.css?v=3.3');
  ok('api', 'الأصول المُرقّمة بكاش immutable', r.status === 200 && /immutable/.test(r.headers.get('cache-control') || ''));
  r = await req('/app.js?v=3.3');
  ok('api', 'app.js يُقدَّم (200)', r.status === 200);

  r = await req('/api/stats');
  ok('api', '/api/stats', r.json && typeof r.json.clients === 'number' && typeof r.json.pendingReminders === 'number');

  // ─── قاعدة البيانات المدرّبة ───
  r = await req('/api/clients');
  const names = r.json.map(c => c.nationalId || '');
  ok('api', '📚 قاعدة التدريب: بطاقة CD220673 موجودة', names.includes('CD220673'));
  ok('api', '📚 قاعدة التدريب: بطاقة DO59740 موجودة', names.includes('DO59740'));
  ok('api', '📚 قاعدة التدريب: وصل V172782 موجود', names.includes('V172782'));
  ok('api', '📚 قاعدة التدريب: 8 عملاء مدرّبين', r.json.length === 8, 'العدد: ' + r.json.length);

  // ─── العملاء + التذكير التلقائي ───
  r = await req('/api/clients', 'POST', { fullName: 'عميل الاختبار', nationalId: 'TEST123', phone: '0600000000' });
  ok('api', 'POST /api/clients ينشئ عميلاً جديداً (201)', r.status === 201 && r.json?.isNew === true);
  ok('api', '⏰ تذكير تلقائي أُنشئ مع العميل', !!r.json?.reminderAt);
  const testClientId = r.json?.id;

  r = await req('/api/reminders');
  const rem = r.json.find(x => x.clientName === 'عميل الاختبار');
  ok('api', '⏰ /api/reminders يحتوي تذكير العميل', !!rem && rem.sent === false);
  ok('api', '⏰ مدة التذكير الافتراضية 5 ساعات', rem && rem.hours === 5, 'hours=' + (rem && rem.hours));

  // تحديث عميل موجود (نفس المعرف) بدل التكرار
  r = await req('/api/clients', 'POST', { fullName: 'عميل الاختبار المحدّث', nationalId: 'TEST123', email: 't@t.com' });
  ok('api', 'upsert: نفس المعرف يحدّث بدل التكرار', r.status === 200 && r.json?.isNew === false);
  r = await req('/api/clients');
  ok('api', 'upsert: لا تكرار للعميل', r.json.filter(c => c.nationalId === 'TEST123').length === 1);
  ok('api', 'upsert: البيانات حُدّثت', r.json.find(c => c.nationalId === 'TEST123').email === 't@t.com');

  // ─── تعديل عميل (v3.3) ───
  r = await req('/api/clients/update', 'POST', { id: testClientId, fullName: 'عميل معدّل', phone: '0699999999' });
  ok('api', '✏️ POST /api/clients/update يعدّل الحقول', r.status === 200 && r.json?.fullName === 'عميل معدّل' && r.json?.phone === '0699999999');
  ok('api', '✏️ التعديل يحافظ على باقي الحقول', r.json?.nationalId === 'TEST123' && r.json?.email === 't@t.com');
  r = await req('/api/clients/update', 'POST', { id: 'no-such-id', fullName: 'x' });
  ok('api', '✏️ تعديل عميل غير موجود → 404', r.status === 404);

  // مدة التذكير من الإعدادات
  r = await req('/api/settings', 'POST', { reminderHours: 2 });
  r = await req('/api/settings');
  ok('api', '⚙️ حفظ مدة التذكير', r.json?.reminderHours === 2);
  r = await req('/api/clients', 'POST', { fullName: 'عميل ساعتين', nationalId: 'TEST456' });
  r = await req('/api/reminders');
  ok('api', '⏰ التذكير الجديد يحترم مدة الساعتين', r.json.find(x => x.clientName === 'عميل ساعتين')?.hours === 2);
  await req('/api/settings', 'POST', { reminderHours: 5 });

  // ─── حذف عميل (v3.3) ───
  const delClient = (await req('/api/clients', 'POST', { fullName: 'عميل للحذف', nationalId: 'DEL999' })).json;
  ok('api', '🗑 تذكير عميل الحذف أُنشئ', !!delClient?.reminderAt);
  r = await req('/api/clients/' + delClient.id, 'DELETE');
  ok('api', '🗑 DELETE /api/clients/:id', r.status === 200 && r.json?.ok === true);
  r = await req('/api/clients');
  ok('api', '🗑 العميل اختفى من القائمة', !r.json.some(c => c.id === delClient.id));
  r = await req('/api/reminders');
  ok('api', '🗑 تذكيرات العميل حُذفت معه', !r.json.some(x => x.clientId === delClient.id));

  // ─── المهام ───
  r = await req('/api/tasks', 'POST', { title: 'مهمة اختبار', due: 'غداً' });
  ok('api', 'POST /api/tasks (201)', r.status === 201 && r.json?.id);
  const taskId = r.json?.id;
  r = await req('/api/tasks/toggle', 'POST', { id: taskId });
  ok('api', 'toggle المهمة', r.status === 200 && r.json?.done === true);
  r = await req('/api/tasks/' + taskId, 'DELETE');
  ok('api', 'DELETE المهمة', r.status === 200);

  // ─── رمز الأمان ───
  r = await req('/api/settings');
  const tok1 = r.json?.accessToken;
  ok('api', '🔐 رمز الأمان مولّد تلقائياً (COA-)', /^COA-[0-9A-F]{8}$/.test(tok1 || ''), tok1);
  r = await req('/api/token/regen', 'POST', {});
  ok('api', '🔐 توليد رمز جديد', r.status === 200 && r.json?.token && r.json.token !== tok1);

  // ─── OCR بدون مفتاح ───
  r = await req('/api/ocr', 'POST', { image: 'aGVsbG8=' });
  ok('api', '/api/ocr بدون مفتاح Kimi يرجع خطأ واضح', r.status === 400 && r.json?.error);

  // ─── تلغرام بدون رمز ───
  r = await req('/api/telegram/test', 'POST', {});
  ok('api', 'telegram/test بدون رمز → خطأ واضح', r.status === 400 && r.json?.error);
  r = await req('/api/telegram/send', 'POST', {});
  ok('api', 'telegram/send بدون رمز → خطأ واضح', r.status === 400 && r.json?.error);
  r = await req('/api/telegram/bot', 'POST', { action: 'start' });
  ok('api', 'bot/start بدون رمز → خطأ واضح', r.status === 400 && r.json?.error);
  r = await req('/api/telegram/bot-status');
  ok('api', 'bot-status يرجع running', r.json && r.json.running === false);

  // ─── Kimi بدون مفتاح ───
  r = await req('/api/chat', 'POST', { message: 'اختبار' });
  ok('api', '/api/chat بدون مفتاح → خطأ واضح', r.status === 400 && r.json?.error);
  r = await req('/api/kimi/test', 'POST', {});
  ok('api', '🌙 /api/kimi/test بدون مفتاح → 400', r.status === 400 && r.json?.error);

  // ─── البحث ───
  r = await req('/api/search', 'POST', { q: 'معدّل' });
  ok('api', '/api/search يجد العميل', r.json && r.json.results.some(x => (x.name || '').includes('معدّل')));
  r = await req('/api/search', 'POST', { q: 'xyz-لا-يوجد-إطلاقا' });
  ok('api', 'البحث بدون نتائج → قائمة فارغة', r.json && r.json.results.length === 0);
  r = await req('/api/search', 'POST', { q: 'CD220673' });
  ok('api', 'البحث برقم بطاقة مدرّبة يجدها', r.json && r.json.results.length > 0);

  // ─── المستخدمون ───
  r = await req('/api/users/toggle-block', 'POST', { id: 999999 });
  ok('api', 'toggle-block لمستخدم غير موجود → 404', r.status === 404);

  // ─── 404 ───
  r = await req('/api/nonexistent');
  ok('api', 'مسار API غير موجود → 404', r.status === 404);
}

// ═══ 3) أوامر البوت ═══
async function testBot() {
  console.log('\n━━━ 🤖 فحص أوامر البوت (محاكاة) ━━━');
  const script = `
const path = ${JSON.stringify(ROOT)};
process.chdir(path);
const fs = require('fs');
let src = fs.readFileSync(path + '/server.js', 'utf8');
src = src.replace(/^#!.*\\n/, '');
src = src.replace(/server\\.listen[\\s\\S]*$/, '');
src += '; module.exports = { handleCommand, db, HELP_TEXT, MAIN_KB };';
const m = { exports: {} };
new Function('module', 'exports', 'require', '__dirname', src)(m, m.exports, require, path);
(async () => {
  const { handleCommand, db, HELP_TEXT, MAIN_KB } = m.exports;
  const txt = r => typeof r === 'string' ? r : (r && r.text) || '';
  const user = { id: 777, username: 'tester', blocked: false, authed: true };
  const chatId = 777;
  const out = [];
  const t = async (cmd, args, check) => {
    const r = await handleCommand(null, cmd, args, user, chatId);
    out.push({ cmd, args, ok: check(r), sample: txt(r).slice(0, 60) });
  };
  await t('/start', '', r => txt(r).includes('مرحباً') && r.reply_markup === MAIN_KB);
  await t('/help', '', r => txt(r).includes('/auth') && txt(r).includes('/reminders'));
  await t('/id', '', r => txt(r).includes('777'));
  await t('/ping', '', r => txt(r).includes('بونغ'));
  await t('/version', '', r => txt(r).includes('3.3'));
  // محادثة Kimi v3.3
  await t('/chat', '', r => txt(r).includes('⚠️') && !user.aiChat);
  db.settings.kimiApiKey = 'test-key';
  await t('/chat', '', r => txt(r).includes('مفعّل') && user.aiChat === true && r.reply_markup === MAIN_KB);
  await t('/endchat', '', r => txt(r).includes('إيقاف') && user.aiChat === false);
  await t('/endchat', '', r => txt(r).includes('غير مفعّل'));
  db.settings.kimiApiKey = '';
  await t('/stats', '', r => txt(r).includes('تذكيرات'));
  await t('/report', '', r => txt(r).includes('تقرير'));
  await t('/logs', '', r => txt(r).includes('السجلات'));
  await t('/tasks', '', r => typeof r === 'object');
  await t('/addtask', 'اختبار بوت | غداً | عالية', r => txt(r).includes('تمت إضافة المهمة'));
  await t('/addtask', '', r => txt(r).includes('الصيغة'));
  const idx = db.tasks.filter(x=>!x.done).findIndex(x => x.title === 'اختبار بوت') + 1;
  await t('/done', String(idx), r => txt(r).includes('تم إنجاز'));
  await t('/done', '999', r => txt(r).includes('غير صالح'));
  await t('/addtask', 'مهمة للحذف | اليوم', r => txt(r).includes('تمت إضافة'));
  const delIdx = db.tasks.filter(x=>!x.done).findIndex(x => x.title === 'مهمة للحذف') + 1;
  await t('/deltask', String(delIdx), r => txt(r).includes('تم حذف'));
  // عميل + تذكير تلقائي
  const before = db.reminders.length;
  await t('/addclient', 'عميل بوت | B123 | 0611111111', r => txt(r).includes('عميل جديد') && txt(r).includes('تذكير'));
  out.push({ cmd: 'auto-reminder', args: '', ok: db.reminders.length === before + 1 && db.reminders[0].clientName === 'عميل بوت' && db.reminders[0].chatId === 777, sample: 'reminders=' + db.reminders.length });
  await t('/addclient', 'عميل بوت محدّث | B123 | 0622222222', r => txt(r).includes('تحديث'));
  out.push({ cmd: 'upsert-bot', args: '', ok: db.clients.filter(c => c.nationalId === 'B123').length === 1, sample: '' });
  await t('/clients', '', r => txt(r).includes('عميل بوت'));
  await t('/reminders', '', r => txt(r).includes('عميل بوت'));
  await t('/cancelreminder', '1', r => txt(r).includes('إلغاء'));
  await t('/cancelreminder', '99', r => txt(r).includes('غير صالح'));
  await t('/search', 'بوت', r => txt(r).includes('نتائج'));
  await t('/search', 'zzz-no', r => txt(r).includes('لا نتائج'));
  // المدير
  db.users.push({ id: 2, username: 'victim', blocked: false, authed: true });
  await t('/users', '', r => txt(r).includes('للمدير'));
  await t('/admin', '', r => txt(r).includes('مدير'));
  await t('/users', '', r => txt(r).includes('المستخدمون'));
  await t('/block', '2', r => txt(r).includes('حظر') && db.users.find(u=>u.id===2).blocked === true);
  await t('/unblock', '2', r => txt(r).includes('إلغاء حظر'));
  await t('/notify', 'اختبار', r => txt(r).includes('تنبيه'));
  await t('/broadcast', '', r => txt(r).includes('الصيغة'));
  const oldTok = db.settings.accessToken;
  await t('/newtoken', '', r => txt(r).includes(oldTok ? 'رمز جديد' : 'x') && db.settings.accessToken !== oldTok);
  out.push({ cmd: 'newtoken-deauth', args: '', ok: db.users.find(u=>u.id===2).authed === false, sample: '' });
  await t('/xyz', '', r => txt(r).includes('غير معروف'));
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
`;
  return new Promise(resolve => {
    const p = spawn(process.execPath, ['-e', script], { cwd: ROOT });
    let buf = '';
    p.stdout.on('data', d => buf += d);
    p.stderr.on('data', d => console.error('[bot-test]', d.toString().slice(0, 300)));
    p.on('close', () => {
      let arr = [];
      try { arr = JSON.parse(buf.trim().split('\n').pop()); } catch (e) {}
      if (!arr.length) { ok('bot', 'تشغيل محاكاة الأوامر', false, 'لم تُرجع نتائج'); return resolve(); }
      arr.forEach(x => ok('bot', `الأمر ${x.cmd} ${x.args || ''}`.trim(), x.ok, x.sample));
      resolve();
    });
  });
}

// ═══ 4) المزامنة ═══
async function testSync() {
  console.log('\n━━━ 🔄 فحص المزامنة بين البوت والتطبيق ━━━');
  let r = await req('/api/tasks', 'POST', { title: 'مزامنة اختبار', due: 'ي' });
  const id = r.json?.id;
  r = await req('/api/tasks');
  ok('sync', 'مهمة جديدة تظهر فوراً في API', r.json.some(t => t.id === id));

  r = await req('/api/search', 'POST', { q: 'مزامنة اختبار' });
  ok('sync', 'المهمة تظهر في البحث فوراً', r.json.results.some(x => x.name === 'مزامنة اختبار'));

  r = await req('/api/clients', 'POST', { fullName: 'عميل مزامنة', nationalId: 'SYNC1' });
  ok('sync', 'عميل عبر API يولّد تذكيراً فوراً', !!r.json.reminderAt);

  const dataRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
  ok('sync', 'data.json محدّث بالمهام', dataRaw.tasks.some(t => t.title === 'مزامنة اختبار'));
  ok('sync', 'data.json محدّث بالتذكيرات', dataRaw.reminders.some(x => x.clientName === 'عميل مزامنة'));
  ok('sync', '🔐 رمز الأمان محفوظ في data.json فقط', /^COA-/.test(dataRaw.settings.accessToken));
}

// ═══ التشغيل ═══
(async () => {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  🧪 Claw Office AI v3.3 — الاختبار الشامل    ║');
  console.log('╚══════════════════════════════════════════════╝');

  const df = path.join(ROOT, 'data.json');
  if (fs.existsSync(df)) fs.unlinkSync(df);

  const srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(TEST_PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr.on('data', d => console.error('[server]', d.toString().slice(0, 300)));
  await sleep(1500);

  try {
    testUI();
    await testAPI();
    await testBot();
    await testSync();
  } finally {
    srv.kill();
  }

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log(`║   النتيجة: ✅ ${passed} ناجح | ❌ ${failed} فاشل`);
  console.log('╚══════════════════════════════════════════════╝');
  if (failures.length) {
    console.log('\n❌ العناصر التي تحتاج إصلاح:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. [${f.group}] ${f.name} — ${f.detail}`));
  } else {
    console.log('\n🎉 كل العناصر تعمل بنجاح!');
  }
  fs.writeFileSync(path.join(ROOT, 'test-report.json'), JSON.stringify({ passed, failed, failures, results, date: new Date().toISOString() }, null, 2));
  console.log('📄 التقرير الكامل: test-report.json');
  process.exit(failed ? 1 : 0);
})();
