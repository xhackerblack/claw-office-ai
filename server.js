#!/usr/bin/env node
/**
 * Claw Office AI - خادم وكيل المكتب الذكي
 * يعمل بدون أي تبعيات خارجية (Node.js فقط) - مثالي لـ Termux
 * التشغيل: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

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

// ─── واجهات API ───
function handleAPI(req, res, pathname, body) {
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
  return send({ error: 'المسار غير موجود' }, 404);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

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
