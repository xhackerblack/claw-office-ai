#!/usr/bin/env node
/**
 * Claw Office AI - خادم وكيل المكتب الذكي
 * يعمل بدون أي تبعيات خارجية (Node.js فقط) - مثالي لـ Termux
 * التشغيل: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const APP_VERSION = '2.1';
const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data.json');

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

// ─── محرك البوت (ردود تلقائية على تلغرام) ───
let botTimer = null;
let lastUpdateId = 0;

async function botTick() {
  const token = db.settings.telegramBotToken;
  if (!token) return;
  try {
    const r = await tgCall(token, 'getUpdates', { offset: lastUpdateId + 1, limit: 20, timeout: 0 });
    if (!r.ok) { addLog('ERROR', `البوت: فشل الجلب — ${r.description}`); stopBot(); return; }
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
      }
      user.last = 'الآن';

      // الحظر التلقائي للمجهولين
      if (user.blocked) { addLog('ERROR', `تم تجاهل رسالة من محظور: @${username}`); continue; }
      addLog('INFO', `رسالة من @${username}: ${text.slice(0, 60)}`);

      // الردود
      if (text === '/start') {
        await tgCall(token, 'sendMessage', {
          chat_id: chatId,
          text: `🤖 أهلاً بك في Claw Office AI!\n\n✅ تم تسجيلك بنجاح.\n🆔 معرف الدردشة الخاص بك: ${chatId}\n\nالأوامر المتاحة:\n/id — عرض معرفك\n/help — المساعدة`,
        });
        addLog('SUCCESS', `تم الرد على /start من @${username}`);
      } else if (text === '/id') {
        await tgCall(token, 'sendMessage', { chat_id: chatId, text: `🆔 معرف الدردشة: ${chatId}` });
      } else if (text === '/help') {
        await tgCall(token, 'sendMessage', { chat_id: chatId, text: '📋 أوامر البوت:\n/start — التسجيل\n/id — معرف الدردشة\n/help — هذه القائمة' });
      } else if (db.settings.kimiApiKey) {
        // رد ذكي عبر Kimi
        const ai = await kimiChat(db.settings.kimiApiKey, db.settings.kimiModel, text);
        const reply = ai.choices?.[0]?.message?.content || 'عذراً، لم أستطع الرد الآن.';
        await tgCall(token, 'sendMessage', { chat_id: chatId, text: reply });
        addLog('SUCCESS', `رد ذكي (Kimi) على @${username}`);
      } else {
        await tgCall(token, 'sendMessage', { chat_id: chatId, text: '🤖 استلمت رسالتك. (فعّل مفتاح Kimi API من الإعدادات للردود الذكية)' });
      }
    }
    saveDB();
  } catch (e) { addLog('ERROR', `البوت: خطأ شبكة — ${e.message}`); }
}

function startBot() {
  if (botTimer) return;
  botTimer = setInterval(botTick, 3000);
  addLog('SUCCESS', 'تم تشغيل محرك البوت — يرد تلقائياً على الرسائل');
}
function stopBot() {
  if (botTimer) { clearInterval(botTimer); botTimer = null; }
  addLog('WARN', 'تم إيقاف محرك البوت');
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
      startBot();
      return send({ ok: true, running: true });
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

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;

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
    // منع تخزين الملفات القديمة في كاش المتصفح حتى يصل التحديث فوراً
    const headers = { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' };
    if (['.html', '.css', '.js'].includes(path.extname(filePath))) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════╗');
  console.log(`║   🤖 Claw Office AI v${APP_VERSION} - يعمل الآن   ║`);
  console.log('╚════════════════════════════════════════════╝');
  console.log(`🌐 افتح المتصفح على: http://localhost:${PORT}`);
});
