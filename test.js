#!/usr/bin/env node
/**
 * ═══ Claw Office AI — نظام الاختبار الشامل ═══
 * يفحص: كل واجهات API + كل عناصر الواجهة + كل أوامر البوت + المزامنة
 * التشغيل: node test.js
 * النتيجة: تقرير مفصّل + ملف test-report.json
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
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch (e) {}
  return { status: r.status, json, headers: r.headers };
}

// ═══ 1) اختبارات الواجهة (تحليل ثابت) ═══
function testUI() {
  console.log('\n━━━ 🖥 فحص عناصر الواجهة ━━━');
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const appjs = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');

  // كل $('#id') في app.js موجود في index.html
  const ids = new Set();
  for (const m of html.matchAll(/id="([^"]+)"/g)) ids.add(m[1]);
  const usedIds = new Set();
  for (const m of appjs.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)) usedIds.add(m[1]);
  for (const m of appjs.matchAll(/\$\$\('#([a-zA-Z0-9_-]+)/g)) usedIds.add(m[1]);
  const missing = [...usedIds].filter(id => !ids.has(id));
  ok('ui', 'كل المعرفات المستخدمة في app.js موجودة في HTML', missing.length === 0, 'مفقود: ' + missing.join(', '));

  // كل data-go يشير إلى شاشة موجودة
  const screens = new Set();
  for (const m of html.matchAll(/<section id="(screen-[^"]+)"/g)) screens.add(m[1]);
  const gos = new Set();
  for (const m of html.matchAll(/data-go="([^"]+)"/g)) gos.add(m[1]);
  const badGo = [...gos].filter(g => !screens.has(g));
  ok('ui', 'كل أزرار التنقل data-go تشير إلى شاشات موجودة', badGo.length === 0, 'خاطئ: ' + badGo.join(', '));

  // أزرار الشريط السفلي الخمسة
  ok('ui', 'الشريط السفلي يحتوي 5 أزرار تنقل', (html.match(/class="nav-btn/g) || []).length === 5);

  // لا تكرار في المعرفات
  const idArr = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const dupes = idArr.filter((v, i) => idArr.indexOf(v) !== i);
  ok('ui', 'لا توجد معرفات مكررة في HTML', dupes.length === 0, 'مكرر: ' + [...new Set(dupes)].join(', '));

  // دعم RTL والعربية والخط
  ok('ui', 'الاتجاه RTL واللغة العربية', html.includes('dir="rtl"') && html.includes('lang="ar"'));
  ok('ui', 'خط Cairo محمّل بشكل غير حاجب (media=print onload)', html.includes('media="print"') && html.includes('Cairo'));
  ok('ui', 'safe-area للهاتف مدعوم', html.includes('viewport-fit=cover') && css.includes('safe-area-inset-bottom'));

  // كل شاشة لها محتوى
  for (const s of screens) {
    const re = new RegExp(`<section id="${s}"[^>]*>([\\s\\S]*?)</section>`);
    const body = (html.match(re) || [])[1] || '';
    ok('ui', `الشاشة ${s} غير فارغة`, body.trim().length > 100);
  }

  // أصناف CSS المولّدة من JS موجودة في styles.css
  const jsClasses = new Set();
  for (const m of appjs.matchAll(/class="([a-zA-Z0-9_ -]+)"/g)) {
    m[1].split(/\s+/).forEach(c => {
      if (/^[a-z][a-z0-9-]+$/.test(c) && !c.startsWith('${')) jsClasses.add(c);
    });
  }
  const missingCss = [...jsClasses].filter(c => !css.includes('.' + c));
  ok('ui', 'كل الأصناف المولّدة من JS لها أنماط CSS', missingCss.length === 0, 'بدون نمط: ' + missingCss.join(', '));

  // أمان XSS: إدخال المستخدم يجب أن يُهرَّب قبل innerHTML
  const xssRisk = /insertAdjacentHTML\('beforeend', `<div class="msg me">\$\{inp\.value\}/.test(appjs);
  ok('ui', 'أمان: رسالة الدردشة مهرَّبة ضد XSS', !xssRisk, 'inp.value يُحقن خاماً');
  ok('ui', 'أمان: دالة esc() موجودة وتُستخدم', appjs.includes('function esc(') && appjs.includes('${esc('));

  // البحث العميق: رموز RegExp الخاصة مهرَّبة
  ok('ui', 'البحث العميق: رموز خاصة مهرَّبة (escRe)', appjs.includes('escRe(q)'));
}

// ═══ 2) اختبارات API ═══
async function testAPI() {
  console.log('\n━━━ 🌐 فحص واجهات API ━━━');

  let r = await req('/api/version');
  ok('api', '/api/version يرجع الإصدار', r.status === 200 && r.json?.version, JSON.stringify(r.json));

  r = await req('/');
  ok('api', 'الصفحة الرئيسية تُقدَّم (200)', r.status === 200);

  r = await req('/styles.css');
  ok('api', 'styles.css يُقدَّم مع كاش طويل', r.status === 200 && /max-age=31536000/.test(r.headers.get('cache-control') || ''));

  r = await req('/app.js');
  ok('api', 'app.js يُقدَّم (200)', r.status === 200);

  r = await req('/api/stats');
  ok('api', '/api/stats يرجع إحصائيات', r.json && typeof r.json.clients === 'number' && typeof r.json.tasks === 'number');

  // المهام: إضافة ثم قراءة
  r = await req('/api/tasks', 'POST', { title: 'مهمة اختبار', client: 'عميل اختبار', due: 'غداً' });
  ok('api', 'POST /api/tasks يضيف مهمة', r.status === 201 && r.json?.title === 'مهمة اختبار');
  const taskId = r.json?.id;
  r = await req('/api/tasks');
  ok('api', 'GET /api/tasks يحتوي المهمة الجديدة', Array.isArray(r.json) && r.json.some(t => t.id === taskId));

  // العملاء: إضافة ثم قراءة
  r = await req('/api/clients', 'POST', { fullName: 'عميل الاختبار', nationalId: 'TEST123' });
  ok('api', 'POST /api/clients يضيف عميلاً', r.status === 201 && r.json?.fullName === 'عميل الاختبار');
  r = await req('/api/clients');
  ok('api', 'GET /api/clients يحتوي العميل الجديد', Array.isArray(r.json) && r.json.some(c => c.nationalId === 'TEST123'));

  // المستخدمون + الحظر
  r = await req('/api/users');
  ok('api', 'GET /api/users يرجع قائمة', Array.isArray(r.json) && r.json.length > 0);
  const u1 = r.json.find(u => u.id === 1);
  r = await req('/api/users/toggle-block', 'POST', { id: 1 });
  ok('api', 'toggle-block يبدّل حالة الحظر', r.status === 200 && r.json?.blocked === !u1.blocked);
  r = await req('/api/users/toggle-block', 'POST', { id: 1 }); // إرجاع
  r = await req('/api/users/toggle-block', 'POST', { id: 999999 });
  ok('api', 'toggle-block لمستخدم غير موجود يرجع 404', r.status === 404);

  // السجلات
  r = await req('/api/logs');
  ok('api', 'GET /api/logs يرجع سجلات', Array.isArray(r.json) && r.json.length > 0 && r.json[0].level);

  // الإعدادات
  r = await req('/api/settings', 'POST', { testKey: 'testValue' });
  ok('api', 'POST /api/settings يحفظ', r.status === 200 && r.json?.testKey === 'testValue');
  r = await req('/api/settings');
  ok('api', 'GET /api/settings يقرأ المحفوظ', r.json?.testKey === 'testValue');

  // البحث
  r = await req('/api/search', 'POST', { q: 'اختبار' });
  ok('api', 'POST /api/search يجد العميل والمهمة', Array.isArray(r.json) && r.json.length >= 2, JSON.stringify(r.json?.length));
  r = await req('/api/search', 'POST', { q: 'xyz-لا-يوجد' });
  ok('api', 'البحث بدون نتائج يرجع قائمة فارغة', Array.isArray(r.json) && r.json.length === 0);

  // تلغرام بدون رمز — يجب رسالة خطأ واضحة (لا crash)
  r = await req('/api/telegram/test', 'POST', {});
  ok('api', 'telegram/test بدون رمز يرجع خطأ واضح', r.status === 400 && r.json?.error);
  r = await req('/api/telegram/send', 'POST', {});
  ok('api', 'telegram/send بدون معطيات يرجع خطأ واضح', r.status === 400 && r.json?.error);
  r = await req('/api/telegram/bot', 'POST', { action: 'start' });
  ok('api', 'bot/start بدون رمز يرجع خطأ واضح', r.status === 400 && r.json?.error);
  r = await req('/api/telegram/bot-status');
  ok('api', 'bot-status يرجع running=false', r.json && r.json.running === false);

  // Kimi بدون مفتاح
  r = await req('/api/ai/chat', 'POST', { message: 'اختبار' });
  ok('api', 'ai/chat بدون مفتاح يرجع خطأ واضح', r.status === 400 && r.json?.error);

  // مسار غير موجود
  r = await req('/api/nonexistent');
  ok('api', 'مسار API غير موجود يرجع 404', r.status === 404);
  r = await req('/no-such-page.html');
  ok('api', 'صفحة غير موجودة ترجع 404', r.status === 404);
}

// ═══ 3) اختبارات أوامر البوت (محاكاة داخلية) ═══
async function testBot() {
  console.log('\n━━━ 🤖 فحص أوامر البوت (محاكاة) ━━━');
  const script = `
const path = ${JSON.stringify(ROOT)};
const fs = require('fs');
let src = fs.readFileSync(path + '/server.js', 'utf8');
src = src.replace(/^#!.*\\n/, ''); // حذف سطر shebang
src = src.replace(/server\\.listen[\\s\\S]*$/, '');
src += '; module.exports = { handleCommand, db, HELP_TEXT };';
const m = { exports: {} };
const fn = new Function('module', 'exports', 'require', '__dirname', src);
fn(m, m.exports, require, path);
(async () => {
  const { handleCommand, db, HELP_TEXT } = m.exports;
  const user = { id: 777, username: 'tester', handle: '@tester', blocked: false };
  const chatId = 777;
  const out = [];
  const t = async (cmd, args, check) => {
    const r = await handleCommand(null, cmd, args, user, chatId);
    out.push({ cmd, args, ok: check(r), sample: (r || '').slice(0, 60) });
  };
  await t('/start', '', r => r && r.includes('أهلاً'));
  await t('/help', '', r => r === HELP_TEXT);
  await t('/id', '', r => r && r.includes('777'));
  await t('/ping', '', r => r && r.includes('Pong'));
  await t('/version', '', r => r && r.includes('مدة التشغيل'));
  await t('/stats', '', r => r && r.includes('إحصائيات'));
  await t('/report', '', r => r && r.includes('تقرير'));
  await t('/logs', '3', r => r && r.includes('سجلات'));
  await t('/logs', 'abc', r => r !== null);
  await t('/tasks', '', r => r && (r.includes('المهام') || r.includes('لا توجد')));
  await t('/addtask', 'اختبار بوت | عميل | غداً', r => r && r.includes('تمت إضافة المهمة'));
  await t('/addtask', '', r => r && r.includes('الصيغة'));
  const idx = db.tasks.findIndex(x => x.title === 'اختبار بوت') + 1;
  await t('/done', String(idx), r => r && r.includes('أُنجزت'));
  await t('/done', '999', r => r && r.includes('غير صالح'));
  await t('/deltask', String(idx), r => r && r.includes('حُذفت'));
  await t('/addclient', 'عميل بوت | B123', r => r && r.includes('تمت إضافة العميل'));
  await t('/clients', '', r => r && r.includes('عميل بوت'));
  await t('/search', 'بوت', r => r && r.includes('نتائج'));
  await t('/search', 'zzz-no', r => r && r.includes('لا نتائج'));
  await t('/users', '', r => r && r.includes('المستخدمون'));
  await t('/admin', '', r => r && r.includes('مدير'));
  await t('/block', '2', r => r && r.includes('حظر'));
  await t('/unblock', '2', r => r && r.includes('إلغاء حظر'));
  await t('/notify', 'اختبار إشعار', r => r && r.includes('الإشعار'));
  await t('/broadcast', '', r => r && r.includes('الصيغة'));
  await t('/unknown', '', r => r === null);
  console.log(JSON.stringify(out));
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
`;
  return new Promise(resolve => {
    const p = spawn(process.execPath, ['-e', script], { cwd: ROOT });
    let buf = '';
    p.stdout.on('data', d => buf += d);
    p.stderr.on('data', d => console.error('[bot-test]', d.toString().slice(0, 200)));
    p.on('close', () => {
      let arr = [];
      try { arr = JSON.parse(buf.trim().split('\n').pop()); } catch (e) {}
      if (!arr.length) { ok('bot', 'تشغيل محاكاة الأوامر', false, 'لم تُرجع نتائج'); return resolve(); }
      arr.forEach(x => ok('bot', `الأمر ${x.cmd} ${x.args || ''}`.trim(), x.ok, x.sample));
      resolve();
    });
  });
}

// ═══ 4) اختبارات المزامنة (البوت ↔ التطبيق) ═══
async function testSync() {
  console.log('\n━━━ 🔄 فحص المزامنة بين البوت والتطبيق ━━━');
  // مهمة أضيفت عبر API (كما يفعل البوت) يجب أن تظهر في /api/tasks فوراً
  let r = await req('/api/tasks', 'POST', { title: 'مزامنة اختبار', client: 'ز', due: 'ي' });
  const id = r.json?.id;
  r = await req('/api/tasks');
  ok('sync', 'مهمة جديدة تظهر فوراً في واجهة API (نفس مصدر البوت)', r.json.some(t => t.id === id));

  // عميل جديد يظهر في البحث فوراً
  r = await req('/api/search', 'POST', { q: 'مزامنة اختبار' });
  ok('sync', 'المهمة الجديدة تظهر في البحث العميق فوراً', r.json.some(x => x.name === 'مزامنة اختبار'));

  // حظر مستخدم ينعكس في /api/users فوراً (نفس ما يفعل /block في البوت)
  await req('/api/users/toggle-block', 'POST', { id: 2 });
  r = await req('/api/users');
  const u2 = r.json.find(u => u.id === 2);
  ok('sync', 'تغيير الحظر ينعكس فوراً في API', u2 && u2.blocked === false && u2.status === 'ACTIVE');

  // الإعدادات المشتركة بين التطبيق والبوت
  r = await req('/api/settings', 'POST', { telegramBotToken: 'FAKE-FOR-TEST' });
  r = await req('/api/telegram/bot-status');
  ok('sync', 'bot-status متاح بعد حفظ الرمز', r.status === 200);
  await req('/api/settings', 'POST', { telegramBotToken: '' });

  // ملف data.json يُحدَّث فعلياً على القرص
  const dataRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
  ok('sync', 'data.json على القرص محدّث بالمهام الجديدة', dataRaw.tasks.some(t => t.title === 'مزامنة اختبار'));
}

// ═══ التشغيل ═══
(async () => {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   🧪 Claw Office AI — نظام الاختبار الشامل   ║');
  console.log('╚══════════════════════════════════════════════╝');

  // تنظيف قاعدة بيانات الاختبار
  const df = path.join(ROOT, 'data.json');
  if (fs.existsSync(df)) fs.unlinkSync(df);

  // تشغيل الخادم
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
