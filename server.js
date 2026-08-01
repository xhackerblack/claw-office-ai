#!/usr/bin/env node
/**
 * Claw Office AI - خادم وكيل المكتب الذكي
 * يعمل بدون أي تبعيات خارجية (Node.js فقط) - مثالي لـ Termux
 * التشغيل: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_VERSION = '2.3';
const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data.json');
const BOOT_TIME = Date.now();

// ─── قاعدة بيانات JSON بسيطة ───
let db = { clients: [], tasks: [], users: [], logs: [], settings: {} };
try {
  if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) { console.log('[WARN] تعذر قراءة data.json، سيتم البدء بقاعدة فارغة'); }

function saveDB() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch (e) {}
}

// بيانات تجريبية أول مرة
if (db.logs.length === 0) {
  db.logs = [
    { time: new Date().toISOString(), level: 'INFO', text: 'تمت تهيئة خادم Claw Office AI' },
    { time: new Date().toISOString(), level: 'SUCCESS', text: 'قاعدة البيانات جاهزة' },
  ];
  db.tasks = [
    { id: '1', title: 'ملفات المراجعة الضريبية', client: 'العميل أ', due: '26 أكتوبر', status: 'PROCESSING' },
    { id: '2', title: 'مراجعة العقد', client: 'العميل ب', due: '27 أكتوبر', status: 'MISSING_INFO' },
    { id: '3', title: 'التقرير المالي Q3', client: 'العميل ج', due: '30 أكتوبر', status: 'READY' },
  ];
  db.users = [
    { id: 1, username: 'john_doe', handle: '@john_doe', status: 'ACTIVE', blocked: false, last: 'الآن' },
    { id: 2, username: 'unknown_99', handle: '@unknown_99', status: 'BLOCKED', blocked: true, last: 'منذ ساعة' },
  ];
  saveDB();
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function addLog(level, text) {
  db.logs.unshift({ time: new Date().toISOString(), level, text });
  if (db.logs.length > 500) db.logs = db.logs.slice(0, 500);
  saveDB();
}

// ─── مساعدات الاتصال الخارجي ───
async function tgCall(token, method, payload = {}) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

async function kimiChat(apiKey, model, message) {
  const payload = JSON.stringify({
    model: model || 'kimi-k2-0711-preview',
    messages: [
      { role: 'system', content: 'أنت مدير الذكاء الاصطناعي في تطبيق Claw Office AI لإدارة المكاتب. أجب بالعربية باختصار واحترافية.' },
      { role: 'user', content: message },
    ],
    temperature: 0.6,
  });
  // تجربة النطاق الدولي ثم الصيني كاحتياط
  const hosts = ['https://api.moonshot.ai/v1/chat/completions', 'https://api.moonshot.cn/v1/chat/completions'];
  let lastErr = null;
  for (const url of hosts) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: payload,
      });
      const j = await r.json();
      // إن كان الخطأ مصادقة، لا فائدة من تجربة نطاق آخر
      if (r.status === 401 || r.status === 403) return j;
      if (j.choices) return j;
      lastErr = j;
    } catch (e) { lastErr = { error: { message: e.message } }; }
  }
  return lastErr;
}

// ═══════════════════════════════════════════════
// ─── محرك البوت v2.3 (أوامر مخصصة + إصلاح كامل) ───
// ═══════════════════════════════════════════════
let botTimer = null;
let lastUpdateId = 0;
let botFailCount = 0;

const STATUS_EMOJI = { PROCESSING: '⏳', MISSING_INFO: '⚠️', READY: '✅' };
const STATUS_TEXT = { PROCESSING: 'قيد المعالجة', MISSING_INFO: 'ينقصه معلومات', READY: 'جاهز' };

// حذف أي Webhook قديم — السبب الأول لعدم استقبال الرسائل (خطأ 409)
async function botFixWebhook(token) {
  try {
    const info = await tgCall(token, 'getWebhookInfo');
    if (info.ok && info.result.url) {
      console.log(`🔧 البوت: وُجد Webhook قديم (${info.result.url}) — جارٍ حذفه...`);
      addLog('WARN', `البوت: حذف Webhook قديم كان يمنع استقبال الرسائل`);
      await tgCall(token, 'deleteWebhook', { drop_pending_updates: false });
    } else {
      await tgCall(token, 'deleteWebhook', { drop_pending_updates: false });
    }
    return true;
  } catch (e) {
    addLog('ERROR', `البوت: تعذر حذف Webhook — ${e.message}`);
    return false;
  }
}

// معالج الأوامر المخصصة
function buildCommandReply(cmd, user, chatId) {
  const uptimeSec = Math.floor((Date.now() - BOOT_TIME) / 1000);
  const up = uptimeSec > 3600
    ? `${Math.floor(uptimeSec / 3600)}س ${Math.floor((uptimeSec % 3600) / 60)}د`
    : uptimeSec > 60 ? `${Math.floor(uptimeSec / 60)}د ${uptimeSec % 60}ث` : `${uptimeSec}ث`;

  switch (cmd) {
    case '/start':
      return `🤖 أهلاً بك في Claw Office AI!\n\n✅ تم تسجيلك بنجاح يا ${user.username}\n🆔 معرف الدردشة: ${chatId}\n\n📋 الأوامر المتاحة:\n/help — كل الأوامر\n/id — معلومات حسابك\n/stats — إحصائيات المكتب\n/tasks — قائمة المهام\n/clients — قائمة العملاء\n/users — إحصائيات المستخدمين\n/logs — آخر السجلات\n/ping — فحص سرعة البوت\n/version — إصدار النظام`;
    case '/help':
      return `📋 أوامر Claw Office AI:\n\n/start — التسجيل والترحيب\n/help — هذه القائمة\n/id — معرف الدردشة وحالة حسابك\n/stats — إحصائيات عامة\n/tasks — عرض كل المهام وحالاتها\n/clients — عرض العملاء المسجلين\n/users — عدد المستخدمين والمحظورين\n/logs — آخر 5 سجلات من النظام\n/ping — فحص أن البوت يعمل\n/version — إصدار النظام ومدة التشغيل\n\n💡 أرسل أي نص آخر وسأرد عليك بالذكاء الاصطناعي (إذا كان مفتاح Kimi مفعّلاً).`;
    case '/id':
      return `👤 معلومات حسابك:\n\n🆔 معرف الدردشة: ${chatId}\n🙍 الاسم: ${user.username}\n📛 الحالة: ${user.blocked ? '🚫 محظور' : '✅ نشط'}`;
    case '/ping':
      return `🏓 Pong! البوت يعمل بشكل ممتاز\n⚡ الإصدار: v${APP_VERSION}`;
    case '/version':
      return `📦 Claw Office AI v${APP_VERSION}\n⏱ مدة التشغيل: ${up}\n🟢 Node.js: ${process.version}`;
    case '/stats':
      return `📊 إحصائيات المكتب:\n\n🧾 العملاء: ${db.clients.length}\n✅ المهام: ${db.tasks.length}\n👥 المستخدمون: ${db.users.length}\n📜 السجلات: ${db.logs.length}\n🤖 دقة الذكاء الاصطناعي: 98.5%`;
    case '/tasks': {
      if (!db.tasks.length) return '📭 لا توجد مهام مسجلة حالياً.';
      const list = db.tasks.slice(0, 10).map((t, i) =>
        `${i + 1}. ${STATUS_EMOJI[t.status] || '📌'} ${t.title}\n    👤 ${t.client || '—'} | 📅 ${t.due || '—'} | ${STATUS_TEXT[t.status] || t.status}`
      ).join('\n\n');
      return `✅ المهام (${db.tasks.length}):\n\n${list}`;
    }
    case '/clients': {
      if (!db.clients.length) return '📭 لا يوجد عملاء مسجلون حالياً.\nأضف عميلاً من التطبيق وسيظهر هنا.';
      const list = db.clients.slice(0, 10).map((c, i) =>
        `${i + 1}. 👤 ${c.fullName || 'بدون اسم'}${c.nationalId ? ` — ${c.nationalId}` : ''}`
      ).join('\n');
      return `🧾 العملاء (${db.clients.length}):\n\n${list}`;
    }
    case '/users': {
      const blocked = db.users.filter(u => u.blocked).length;
      return `👥 إحصائيات المستخدمين:\n\n✅ النشطون: ${db.users.length - blocked}\n🚫 المحظورون: ${blocked}\n📊 الإجمالي: ${db.users.length}`;
    }
    case '/logs': {
      const icons = { INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌' };
      const list = db.logs.slice(0, 5).map(l =>
        `${icons[l.level] || '•'} ${l.text}`
      ).join('\n');
      return `📜 آخر السجلات:\n\n${list || 'لا توجد سجلات'}`;
    }
    default:
      return null; // ليس أمراً — نمرّر للذكاء الاصطناعي
  }
}

async function botTick() {
  const token = db.settings.telegramBotToken;
  if (!token) return;
  try {
    const r = await tgCall(token, 'getUpdates', { offset: lastUpdateId + 1, limit: 20, timeout: 0 });

    if (!r.ok) {
      const desc = r.description || 'خطأ غير معروف';
      if (String(desc).includes('409')) {
        // تعارض: Webhook أو جلسة polling أخرى — نصلحه ونستمر
        addLog('WARN', `البوت: تعارض 409 — إصلاح تلقائي (حذف Webhook)`);
        await botFixWebhook(token);
        botFailCount = 0;
        return;
      }
      if (r.error_code === 401) {
        addLog('ERROR', `البوت: رمز غير صالح — تم إيقاف المحرك. أدخل رمزاً صحيحاً من @BotFather`);
        console.log('❌ البوت: رمز تلغرام غير صالح — توقف المحرك');
        stopBot();
        return;
      }
      botFailCount++;
      addLog('ERROR', `البوت: فشل الجلب (${botFailCount}) — ${desc}`);
      if (botFailCount >= 10) { addLog('ERROR', 'البوت: كثرة الأخطاء — توقف المحرك'); stopBot(); }
      return;
    }
    botFailCount = 0;

    for (const u of r.result) {
      lastUpdateId = Math.max(lastUpdateId, u.update_id);
      const msg = u.message;
      if (!msg || !msg.text) continue;
      const chatId = msg.chat.id;
      const username = msg.from.username || msg.from.first_name || 'مجهول';
      const text = msg.text.trim();

      // تسجيل المستخدم
      let user = db.users.find(x => x.id === msg.from.id);
      if (!user) {
        user = { id: msg.from.id, username, handle: '@' + username, status: 'ACTIVE', blocked: false, last: 'الآن' };
        db.users.unshift(user);
        addLog('SUCCESS', `مستخدم جديد انضم للبوت: @${username} (${chatId})`);
        console.log(`👤 مستخدم جديد: @${username} (${chatId})`);
      }
      user.last = 'الآن';
      user.username = username;

      // الحظر التلقائي للمجهولين
      if (user.blocked) { addLog('ERROR', `تم تجاهل رسالة من محظور: @${username}`); continue; }
      addLog('INFO', `رسالة من @${username}: ${text.slice(0, 60)}`);
      console.log(`📩 @${username}: ${text.slice(0, 60)}`);

      // استخراج الأمر (يدعم /cmd@BotName)
      const cmd = text.split(' ')[0].split('@')[0].toLowerCase();
      let reply = text.startsWith('/') ? buildCommandReply(cmd, user, chatId) : null;

      if (reply === null && text.startsWith('/') && !buildCommandReply(cmd, user, chatId)) {
        reply = `❓ أمر غير معروف: ${cmd}\nأرسل /help لعرض الأوامر المتاحة.`;
      }

      if (reply === null) {
        // رد ذكي عبر Kimi أو رسالة افتراضية
        if (db.settings.kimiApiKey) {
          const ai = await kimiChat(db.settings.kimiApiKey, db.settings.kimiModel, text);
          reply = ai.choices?.[0]?.message?.content || 'عذراً، لم أستطع الرد الآن.';
          addLog('SUCCESS', `رد ذكي (Kimi) على @${username}`);
        } else {
          reply = '🤖 استلمت رسالتك. فعّل مفتاح Kimi API من الإعدادات للردود الذكية، أو أرسل /help للأوامر.';
        }
      } else {
        addLog('SUCCESS', `تم الرد على ${cmd} من @${username}`);
      }

      const sent = await tgCall(token, 'sendMessage', { chat_id: chatId, text: reply });
      if (sent.ok) console.log(`📤 رد على @${username} ✔`);
      else addLog('ERROR', `البوت: فشل إرسال الرد — ${sent.description}`);
    }
    saveDB();
  } catch (e) {
    addLog('ERROR', `البوت: خطأ شبكة — ${e.message}`);
    console.log(`🌐 البوت: خطأ شبكة — ${e.message}`);
  }
}

async function startBot() {
  if (botTimer) return { already: true };
  const token = db.settings.telegramBotToken;
  if (!token) return { error: 'لا يوجد رمز' };
  // 1) حذف أي Webhook قديم يمنع استقبال الرسائل
  await botFixWebhook(token);
  // 2) التحقق من هوية البوت
  try {
    const me = await tgCall(token, 'getMe');
    if (!me.ok) return { error: me.description || 'رمز غير صالح' };
    addLog('SUCCESS', `تم تشغيل محرك البوت @${me.result.username} — يرد تلقائياً على الرسائل`);
    console.log(`🤖 محرك البوت يعمل: @${me.result.username} — أرسل /start في تلغرام`);
    botTimer = setInterval(botTick, 3000);
    botTick(); // جلب فوري أول مرة
    return { ok: true, username: me.result.username };
  } catch (e) {
    addLog('ERROR', `البوت: تعذر التشغيل — ${e.message}`);
    return { error: e.message };
  }
}
function stopBot() {
  if (botTimer) { clearInterval(botTimer); botTimer = null; }
  addLog('WARN', 'تم إيقاف محرك البوت');
  console.log('⏹ محرك البوت متوقف');
}

// ─── واجهات API ───
async function handleAPI(req, res, pathname, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const send = (obj, code = 200) => { res.writeHead(code); res.end(JSON.stringify(obj)); };

  if (req.method === 'GET' && pathname === '/api/version') {
    return send({ version: APP_VERSION, name: 'Claw Office AI' });
  }
  if (req.method === 'GET' && pathname === '/api/stats') {
    return send({
      learning: 85, knowledge: '1.2 تيرابايت', aiAccuracy: 98.5,
      messagesToday: 1245, activeUsers: 328,
      clients: db.clients.length, tasks: db.tasks.length,
    });
  }
  if (req.method === 'GET' && pathname === '/api/tasks') return send(db.tasks);
  if (req.method === 'POST' && pathname === '/api/tasks') {
    const t = { id: Date.now().toString(), status: 'PROCESSING', ...body };
    db.tasks.unshift(t); addLog('INFO', `تمت إضافة مهمة: ${t.title}`); saveDB();
    return send(t, 201);
  }
  if (req.method === 'GET' && pathname === '/api/users') return send(db.users);
  if (req.method === 'POST' && pathname === '/api/users/toggle-block') {
    const u = db.users.find(x => x.id === body.id);
    if (!u) return send({ error: 'المستخدم غير موجود' }, 404);
    u.blocked = !u.blocked; u.status = u.blocked ? 'BLOCKED' : 'ACTIVE';
    addLog(u.blocked ? 'ERROR' : 'SUCCESS', `${u.blocked ? 'تم حظر' : 'تم إلغاء حظر'} المستخدم ${u.handle}`);
    saveDB(); return send(u);
  }
  if (req.method === 'GET' && pathname === '/api/logs') return send(db.logs);
  if (req.method === 'GET' && pathname === '/api/clients') return send(db.clients);
  if (req.method === 'POST' && pathname === '/api/clients') {
    const c = { id: Date.now().toString(), verified: false, createdAt: new Date().toISOString(), ...body };
    db.clients.unshift(c); addLog('SUCCESS', `تمت إضافة عميل: ${c.fullName}`); saveDB();
    return send(c, 201);
  }
  if (req.method === 'GET' && pathname === '/api/settings') return send(db.settings);
  if (req.method === 'POST' && pathname === '/api/settings') {
    db.settings = { ...db.settings, ...body }; saveDB();
    addLog('INFO', 'تم تحديث الإعدادات'); return send(db.settings);
  }
  if (req.method === 'POST' && pathname === '/api/search') {
    const q = (body.q || '').toLowerCase();
    const results = [];
    db.clients.forEach(c => {
      if (JSON.stringify(c).toLowerCase().includes(q)) results.push({ type: 'عميل', name: c.fullName, detail: c.nationalId || '', time: c.createdAt });
    });
    db.tasks.forEach(t => {
      if (JSON.stringify(t).toLowerCase().includes(q)) results.push({ type: 'مهمة', name: t.title, detail: t.client, time: t.due });
    });
    return send(results);
  }
  // ─── تلغرام ───
  if (req.method === 'POST' && pathname === '/api/telegram/test') {
    const token = body.token || db.settings.telegramBotToken;
    if (!token) { addLog('WARN', 'تلغرام: لم يتم إدخال رمز البوت'); return send({ ok: false, error: 'أدخل رمز البوت أولاً' }, 400); }
    try {
      const r = await tgCall(token, 'getMe');
      if (r.ok) { addLog('SUCCESS', `تلغرام: تم الاتصال بالبوت @${r.result.username}`); return send({ ok: true, bot: r.result }); }
      addLog('ERROR', `تلغرام: فشل الاتصال — ${r.description}`);
      return send({ ok: false, error: r.description }, 401);
    } catch (e) { addLog('ERROR', `تلغرام: خطأ شبكة — ${e.message}`); return send({ ok: false, error: e.message }, 500); }
  }
  if (req.method === 'POST' && pathname === '/api/telegram/send') {
    const token = body.token || db.settings.telegramBotToken;
    if (!token || !body.chatId || !body.text) return send({ ok: false, error: 'الرمز ومعرف الدردشة والنص مطلوبة' }, 400);
    try {
      const r = await tgCall(token, 'sendMessage', { chat_id: body.chatId, text: body.text });
      if (r.ok) { addLog('SUCCESS', `تلغرام: تم إرسال رسالة إلى ${body.chatId}`); return send({ ok: true, result: r.result }); }
      addLog('ERROR', `تلغرام: فشل الإرسال — ${r.description}`);
      return send({ ok: false, error: r.description }, 400);
    } catch (e) { addLog('ERROR', `تلغرام: خطأ شبكة — ${e.message}`); return send({ ok: false, error: e.message }, 500); }
  }
  if (req.method === 'GET' && pathname === '/api/telegram/updates') {
    const token = db.settings.telegramBotToken;
    if (!token) { addLog('WARN', 'تلغرام: احفظ رمز البوت في الإعدادات أولاً'); return send({ ok: false, error: 'احفظ رمز البوت أولاً (زر اختبار الاتصال يحفظه)' }, 400); }
    try {
      const r = await tgCall(token, 'getUpdates', { limit: 10 });
      if (r.ok) {
        const msgs = r.result.map(u => ({
          from: u.message?.from?.username || u.message?.from?.first_name || 'مجهول',
          chatId: u.message?.chat?.id,
          text: u.message?.text || '(غير نصية)',
          date: u.message?.date ? new Date(u.message.date * 1000).toLocaleString('ar') : '',
        })).reverse();
        addLog('INFO', `تلغرام: تم جلب ${msgs.length} رسالة`);
        return send({ ok: true, messages: msgs });
      }
      addLog('ERROR', `تلغرام: فشل جلب الرسائل — ${r.description}`);
      return send({ ok: false, error: r.description }, 400);
    } catch (e) { addLog('ERROR', `تلغرام: خطأ شبكة — ${e.message}`); return send({ ok: false, error: e.message }, 500); }
  }
  if (req.method === 'POST' && pathname === '/api/telegram/bot') {
    const token = body.token || db.settings.telegramBotToken;
    if (!token) return send({ ok: false, error: 'أدخل رمز البوت أولاً' }, 400);
    if (body.action === 'start') {
      db.settings.telegramBotToken = token; saveDB();
      const r = await startBot();
      if (r.error) return send({ ok: false, error: r.error }, 400);
      return send({ ok: true, running: true, username: r.username });
    }
    stopBot();
    return send({ ok: true, running: false });
  }
  if (req.method === 'GET' && pathname === '/api/telegram/bot-status') {
    return send({ running: !!botTimer });
  }

  // ─── Kimi AI ───
  if (req.method === 'POST' && pathname === '/api/ai/chat') {
    const key = body.apiKey || db.settings.kimiApiKey;
    if (!key) { addLog('WARN', 'Kimi: لم يتم إدخال مفتاح API'); return send({ ok: false, error: 'أدخل مفتاح Kimi API في الإعدادات' }, 400); }
    try {
      const r = await kimiChat(key, body.model || db.settings.kimiModel, body.message || 'اختبار الاتصال — رد بجملة واحدة');
      if (r.choices && r.choices[0]) {
        const reply = r.choices[0].message.content;
        addLog('SUCCESS', 'Kimi: تم توليد رد بنجاح');
        return send({ ok: true, reply });
      }
      const errMsg = r.error?.message || JSON.stringify(r);
      addLog('ERROR', `Kimi: فشل الطلب — ${errMsg}`);
      return send({ ok: false, error: errMsg }, 401);
    } catch (e) { addLog('ERROR', `Kimi: خطأ شبكة — ${e.message}`); return send({ ok: false, error: e.message }, 500); }
  }

  return send({ error: 'المسار غير موجود' }, 404);
}

// ─── عدادات مراقبة الأداء ───
let reqCount = 0;

const server = http.createServer((req, res) => {
  const t0 = Date.now();
  reqCount++;
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;

  res.on('finish', () => {
    const ms = Date.now() - t0;
    const icon = ms > 500 ? '🐢' : '⚡';
    console.log(`${icon} [${new Date().toLocaleTimeString('ar')}] ${req.method} ${pathname} → ${res.statusCode} (${ms}ms)`);
  });

  if (pathname.startsWith('/api/')) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let json = {};
      try { json = body ? JSON.parse(body) : {}; } catch (e) {}
      handleAPI(req, res, pathname, json);
    });
    return;
  }

  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404 - الصفحة غير موجودة'); }
    const ext = path.extname(filePath);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (ext === '.html') {
      // الصفحة دائماً جديدة حتى تصل التحديثات فوراً
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    } else if (ext === '.css' || ext === '.js') {
      // ملفات CSS/JS مرقّمة بإصدار (?v=) — كاش طويل آمن وسريع جداً
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    } else {
      headers['Cache-Control'] = 'public, max-age=86400';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(PORT, () => {
  const bootMs = Date.now() - BOOT_TIME;
  const mem = process.memoryUsage();
  const mb = n => (n / 1024 / 1024).toFixed(1) + ' MB';
  const dataSize = fs.existsSync(DATA_FILE) ? (fs.statSync(DATA_FILE).size / 1024).toFixed(1) + ' KB' : 'غير موجود';

  console.log('');
  console.log('╔════════════════════════════════════════════════════╗');
  console.log(`║   🤖 Claw Office AI v${APP_VERSION} - يعمل الآن           ║`);
  console.log('╚════════════════════════════════════════════════════╝');
  console.log('');
  console.log('📋 معلومات التشغيل:');
  console.log(`   🌐 الرابط:        http://localhost:${PORT}`);
  console.log(`   📦 الإصدار:       v${APP_VERSION}`);
  console.log(`   🟢 Node.js:       ${process.version}`);
  console.log(`   📱 النظام:        ${os.platform()} / ${os.arch()}`);
  console.log(`   ⏱ زمن الإقلاع:    ${bootMs}ms`);
  console.log(`   💾 الذاكرة:       ${mb(mem.rss)} (RSS)`);
  console.log('');
  console.log('🗄 قاعدة البيانات:');
  console.log(`   📄 الملف:         ${DATA_FILE}`);
  console.log(`   📏 الحجم:         ${dataSize}`);
  console.log(`   👥 المستخدمون:    ${db.users.length}`);
  console.log(`   ✅ المهام:        ${db.tasks.length}`);
  console.log(`   🧾 العملاء:       ${db.clients.length}`);
  console.log(`   📜 السجلات:       ${db.logs.length}`);
  console.log('');
  console.log('⚙️ الإعدادات المحفوظة:');
  console.log(`   ✈️ بوت تلغرام:    ${db.settings.telegramBotToken ? '✔ رمز محفوظ' : '✖ غير مضبوط'}`);
  console.log(`   🌙 مفتاح Kimi:    ${db.settings.kimiApiKey ? '✔ محفوظ' : '✖ غير مضبوط'}`);
  console.log('');
  console.log('─────────────────────────────────────────────────────');
  console.log('📡 سجل الطلبات المباشر (⚡ سريع | 🐢 بطيء +500ms):');
  console.log('─────────────────────────────────────────────────────');
});
