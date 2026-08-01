#!/usr/bin/env node
/**
 * Claw Office AI - خادم وكيل المكتب الذكي
 * يعمل بدون أي تبعيات خارجية (Node.js فقط) - مثالي لـ Termux
 * التشغيل: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

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
  const r = await fetch('https://api.moonshot.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || 'kimi-k2-0711-preview',
      messages: [
        { role: 'system', content: 'أنت مدير الذكاء الاصطناعي في تطبيق Claw Office AI لإدارة المكاتب. أجب بالعربية باختصار واحترافية.' },
        { role: 'user', content: message },
      ],
      temperature: 0.6,
    }),
  });
  return r.json();
}

// ─── واجهات API ───
async function handleAPI(req, res, pathname, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const send = (obj, code = 200) => { res.writeHead(code); res.end(JSON.stringify(obj)); };

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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║        🤖 Claw Office AI - يعمل الآن       ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`🌐 افتح المتصفح على: http://localhost:${PORT}`);
});
