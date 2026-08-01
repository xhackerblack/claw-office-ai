#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DB_FILE = path.join(ROOT, 'data.json');
const APP_VERSION = '3.0';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── DB ───
let db = { clients: [], tasks: [], users: [], logs: [], reminders: [], settings: {} };
if (fs.existsSync(DB_FILE)) { try { db = JSON.parse(fs.readFileSync(DB_FILE)); } catch (e) {} }
db.clients = db.clients || []; db.tasks = db.tasks || []; db.users = db.users || [];
db.logs = db.logs || []; db.reminders = db.reminders || []; db.settings = db.settings || {};
function saveDB() { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (e) {} }
function addLog(level, text) { db.logs.unshift({ level, text, at: new Date().toISOString() }); if (db.logs.length > 500) db.logs = db.logs.slice(0, 500); }

// ─── Security token (التوكن السري للبوت) ───
if (!db.settings.accessToken) {
  db.settings.accessToken = 'COA-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  addLog('system', '🔐 تم توليد رمز أمان جديد للبوت');
}
if (!db.settings.reminderHours) db.settings.reminderHours = 5;

// ─── قاعدة بيانات أولية مدرّبة من مستنداتك ───
if (!db.settings.seededV3) {
  const seed = [
    { fullName: 'AUCHANE HASSANIA', nationalId: 'CD220673', birthDate: '18.05.1984', birthPlace: 'MEKNES', address: 'DOUAR NZALA RDAYA MEKNES', father: 'BOUAZZA ben LAHCEN', mother: 'FATIMA bent ABDESLAM', sex: 'F', phone: '', email: '', expiry: '14.11.2035', docType: 'بطاقة التعريف الوطنية', notes: 'CAN 735285 | رقم عقد الازدياد 383/4/1984' },
    { fullName: 'CHERGUI SIHAM', nationalId: 'DO59740', birthDate: '10.09.1998', birthPlace: 'CHERKAOUA MEKNES', address: 'OUED JDIDA LA GARE OUED JDIDA MEKNES', father: 'ABDELLAH ben ELKHAYATE', mother: 'TOURIA bent DAOUD', sex: 'F', phone: '', email: '', expiry: '10.10.2027', docType: 'بطاقة التعريف الوطنية', notes: 'رقم عقد الازدياد 139/1998' },
    { fullName: 'AIT BAHAMMOU MEHDI', nationalId: 'V172782', birthDate: '20/03/1979', birthPlace: '', address: 'AIT BOUBIDMANE / Douar AIT HSSAINE', father: '', mother: '', sex: 'M', phone: '0667752577', email: '', expiry: '', docType: 'وصل الدعم الاجتماعي', notes: 'طلب 1255426 | IDCS 4663232614 | متزوج | RIB 007780000146508092371289 ATTIJARIWAFA BANK' },
    { fullName: 'ABDELILAH TOUZANI', nationalId: 'D608574', birthDate: '', birthPlace: '', address: '', father: '', mother: '', sex: '', phone: '0622235252', email: '', expiry: '', docType: 'سجل معاملات', notes: 'معاملات بمبلغ 492 MAD (3 عمليات)' },
    { fullName: 'MOHAMED (BRARHA)', nationalId: '', birthDate: '', birthPlace: 'TAZA - BRARHA', address: 'Douar OULED BOUSSADEN, Commune BRARHA, TAINASTE, TAZA', father: '', mother: '', sex: 'M', phone: '0613128808', email: 'boubidmane.sarl@gmail.com', expiry: '', docType: 'استمارة تسجيل', notes: 'رسم الولادة 201/1993' },
    { fullName: 'عبدالرحيم', nationalId: '5500175286', birthDate: '', birthPlace: 'عمالة الحاجب', address: '', father: '', mother: '', sex: 'M', phone: '', email: '', expiry: '', docType: 'استمارة عائلية (notadamon)', notes: 'الزوجة: يسرى 6820281957 | الأبناء: عبد الصمد 6550328572، أمير 7452305474' },
    { fullName: 'زبون LN5915', nationalId: 'LN5915', birthDate: '', birthPlace: '', address: '', father: '', mother: '', sex: '', phone: '0808647073', email: '', expiry: '', docType: 'إيصال فاتورة (IAM)', notes: 'وصل A488418184 | معاملة 841038309 | 501.25 DH | 15/04/2026' },
    { fullName: 'جهة اتصال بريدية', nationalId: '', birthDate: '', birthPlace: '', address: '', father: '', mother: '', sex: '', phone: '', email: 'cvreceuil@gmail.com', expiry: '', docType: 'بريد إلكتروني', notes: '' }
  ];
  const now = new Date().toISOString();
  seed.forEach((c, i) => db.clients.unshift({ id: 'seed' + (i + 1), ...c, source: 'تدريب أولي 📚', verified: true, createdAt: now, updatedAt: now }));
  db.settings.seededV3 = true;
  addLog('system', '📚 تم بناء قاعدة البيانات الأولية من ' + seed.length + ' مستندات مدرّبة');
  saveDB();
}

// ─── Client upsert + reminder ───
function upsertClient(data, source) {
  const nid = String(data.nationalId || '').trim();
  let c = nid ? db.clients.find(x => String(x.nationalId || '').toLowerCase() === nid.toLowerCase()) : null;
  if (!c && data.phone) c = db.clients.find(x => x.phone && x.phone === data.phone);
  const isNew = !c;
  if (!c) { c = { id: Date.now().toString() + Math.floor(Math.random() * 1000), createdAt: new Date().toISOString() }; db.clients.unshift(c); }
  for (const k of ['fullName','nationalId','birthDate','birthPlace','address','father','mother','sex','phone','email','expiry','docType','notes']) {
    if (data[k] !== undefined && String(data[k]).trim() !== '') c[k] = data[k];
  }
  c.verified = true; c.source = source; c.updatedAt = new Date().toISOString();
  saveDB();
  return { client: c, isNew };
}

function scheduleReminder(client, chatId) {
  const hours = parseFloat(db.settings.reminderHours) || 5;
  const r = { id: Date.now().toString() + Math.floor(Math.random() * 1000), clientId: client.id, clientName: client.fullName || 'عميل', chatId: chatId || null, at: Date.now() + hours * 3600e3, hours, sent: false, createdAt: new Date().toISOString() };
  db.reminders.unshift(r);
  if (db.reminders.length > 200) db.reminders = db.reminders.slice(0, 200);
  saveDB();
  return r;
}

function timeAgoStr(iso) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'الآن'; if (m < 60) return 'منذ ' + m + ' دقيقة';
  const h = Math.floor(m / 60); if (h < 24) return 'منذ ' + h + ' ساعة';
  return 'منذ ' + Math.floor(h / 24) + ' يوم';
}
function fmtReminder(r) {
  const d = new Date(r.at);
  return '⏰ تذكير بعد ' + r.hours + ' ساعة — ' + d.toLocaleString('ar-MA', { timeZone: 'Africa/Casablanca' });
}

// ─── Telegram helpers ───
async function tgCall(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}
async function botReply(token, chatId, payload) {
  if (typeof payload === 'string') payload = { text: payload };
  return tgCall(token, 'sendMessage', { chat_id: chatId, ...payload });
}

const MAIN_KB = { keyboard: [
  [{ text: '📊 الإحصائيات' }, { text: '🧾 العملاء' }],
  [{ text: '✅ المهام' }, { text: '⏰ التذكيرات' }],
  [{ text: '🔍 بحث' }, { text: '📜 السجلات' }],
  [{ text: '➕ إضافة عميل' }, { text: '🆔 معرفي' }],
  [{ text: '❓ المساعدة' }]
], resize_keyboard: true };
const BTN = { '📊 الإحصائيات': '/stats', '🧾 العملاء': '/clients', '✅ المهام': '/tasks', '⏰ التذكيرات': '/reminders', '📜 السجلات': '/logs', '🆔 معرفي': '/id', '❓ المساعدة': '/help' };
const pending = new Map(); // userId -> {action}

// ─── Kimi OCR (تحليل الصور بالذكاء الاصطناعي) ───
const OCR_PROMPT = 'أنت نظام استخراج بيانات مستندات مغربية. حلل هذه الصورة وأرجع JSON فقط (بدون أي نص آخر) بالمفاتيح: fullName (الاسم الكامل), nationalId (رقم البطاقة مثل CD220673 أو المعرف الرقمي), birthDate, birthPlace, address, father, mother, sex (M/F), phone, email, expiry (تاريخ انتهاء الصلاحية), docType (نوع المستند بالعربية), notes (أي أرقام مهمة أخرى: مبالغ، RIB، أرقام طلبات). إن لم يوجد حقل اتركه فارغاً "". أسماء الأشخاص بالحروف اللاتينية كما في المستند.';
async function kimiOCR(apiKey, base64, mime) {
  const payload = {
    model: db.settings.kimiVisionModel || 'moonshot-v1-8k-vision-preview',
    temperature: 0.1,
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: 'data:' + (mime || 'image/jpeg') + ';base64,' + base64 } },
      { type: 'text', text: OCR_PROMPT }
    ] }],
    response_format: { type: 'json_object' }
  };
  const hosts = ['https://api.moonshot.ai/v1/chat/completions', 'https://api.moonshot.cn/v1/chat/completions'];
  let lastErr = '';
  for (const url of hosts) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || ('HTTP ' + res.status));
      const reply = data.choices?.[0]?.message?.content || '';
      const m = reply.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error('رد غير صالح');
    } catch (e) { lastErr = e.message; }
  }
  throw new Error(lastErr || 'فشل تحليل الصورة');
}

async function processImageToClient(base64, mime, source, chatId) {
  const apiKey = db.settings.kimiApiKey;
  if (!apiKey) throw new Error('لم يتم ضبط مفتاح Kimi API — أضفه من الإعدادات');
  const data = await kimiOCR(apiKey, base64, mime);
  if (!data || (!data.fullName && !data.nationalId && !data.phone && !data.email)) throw new Error('لم يتم العثور على بيانات قابلة للاستخراج في الصورة');
  const { client, isNew } = upsertClient(data, source);
  const rem = scheduleReminder(client, chatId);
  addLog('success', (isNew ? '🆕 عميل جديد من صورة: ' : '🔄 تحديث عميل من صورة: ') + (client.fullName || client.nationalId));
  return { client, isNew, reminder: rem };
}

function clientCardText(c, isNew, rem) {
  const rows = [
    '👤 الاسم: ' + (c.fullName || '—'),
    c.nationalId ? '🆔 المعرف: ' + c.nationalId : null,
    c.birthDate ? '🎂 الازدياد: ' + c.birthDate + (c.birthPlace ? ' — ' + c.birthPlace : '') : null,
    c.sex ? '⚧ الجنس: ' + (c.sex === 'F' ? 'أنثى' : 'ذكر') : null,
    c.address ? '📍 العنوان: ' + c.address : null,
    c.father ? '👨 الأب: ' + c.father : null,
    c.mother ? '👩 الأم: ' + c.mother : null,
    c.phone ? '📞 الهاتف: ' + c.phone : null,
    c.email ? '✉️ البريد: ' + c.email : null,
    c.expiry ? '📅 صالحة إلى: ' + c.expiry : null,
    c.docType ? '📄 النوع: ' + c.docType : null,
    c.notes ? '📝 ملاحظات: ' + c.notes : null
  ].filter(Boolean).join('\n');
  let t = (isNew ? '✅ تم إنشاء ملف عميل جديد\n\n' : '🔄 تم تحديث ملف العميل الموجود\n\n') + rows;
  if (rem) t += '\n\n━━━━━━━━━━━━━━\n🔔 ' + fmtReminder(rem) + '\nسيصلك إشعار على تلغرام عند حلول الوقت.';
  return t;
}

// ─── Bot Engine ───
let botRunning = false, lastUpdateId = 0, botFailCount = 0;
const BOT_START = Date.now();

const HELP_TEXT = `🤖 Claw Office AI — الأوامر:

🔐 الأمان:
/auth رمز — تفعيل الوصول (انسخ الرمز من الإعدادات)

🧾 العملاء:
/addclient اسم | معرف | هاتف — إضافة عميل (+ تذكير تلقائي)
/clients — قائمة العملاء
📷 أرسل صورة مستند — استخراج تلقائي + ملف عميل + تذكير

✅ المهام:
/addtask عنوان | تاريخ | أولوية
/tasks — المهام (أزرار ✅/🗑)
/done رقم | /deltask رقم

⏰ التذكيرات:
/reminders — التذكيرات القادمة والمرسلة
/cancelreminder رقم — إلغاء تذكير

📊 النظام:
/stats — إحصائيات | /report — تقرير
/search كلمة — بحث شامل
/logs — السجلات | /id — معرفك
/ping — فحص الاستجابة | /version — الإصدار

👑 المدير:
/users /block رقم /unblock رقم
/notify نص /broadcast نص
/newtoken — توليد رمز أمان جديد`;

function requireAdmin(user) { return db.settings.adminId === user.id; }

async function handleCommand(token, cmd, args, user, chatId) {
  const now = Date.now();
  switch (cmd) {
    case '/start': case '/help':
      return { text: (cmd === '/start' ? 'مرحباً بك في Claw Office AI! 🎉\nاختر من الأزرار أسفله أو استعمل الأوامر.\n\n' : '') + HELP_TEXT, reply_markup: MAIN_KB };
    case '/id':
      return `🆔 معرفك: ${user.id}\n👤 المستخدم: ${user.username || 'بدون'}\n🔐 الصلاحية: ${requireAdmin(user) ? 'مدير 👑' : 'مستخدم مصرّح ✅'}`;
    case '/ping': return `🏓 بونغ! (${Date.now() - now}ms)`;
    case '/version': return `🤖 Claw Office AI — الإصدار v${APP_VERSION}\n⏱ مدة التشغيل: ${Math.floor((Date.now() - BOT_START) / 60000)} دقيقة`;
    case '/stats': {
      const today = new Date().toDateString();
      return `📊 الإحصائيات:\n🧾 العملاء: ${db.clients.length}\n✅ المهام: ${db.tasks.filter(t => !t.done).length} نشطة / ${db.tasks.length} إجمالي\n👥 المستخدمون: ${db.users.length}\n⏰ تذكيرات قادمة: ${db.reminders.filter(r => !r.sent).length}\n📜 سجلات اليوم: ${db.logs.filter(l => new Date(l.at).toDateString() === today).length}\n🔔 مدة التذكير: ${db.settings.reminderHours} ساعة`;
    }
    case '/report': {
      const p = db.tasks.filter(t => !t.done).slice(0, 8).map(t => `  • ${t.title}${t.due ? ' 📅' + t.due : ''}`).join('\n');
      return `📋 تقرير المكتب:\n🧾 العملاء: ${db.clients.length} | ✅ مهام نشطة: ${db.tasks.filter(t => !t.done).length}\n⏰ تذكيرات قادمة: ${db.reminders.filter(r => !r.sent).length}\n${p ? '\nالمهام:\n' + p : '\nلا مهام نشطة 🎉'}`;
    }
    case '/logs': {
      const logs = db.logs.slice(0, 8).map(l => `${l.level === 'error' ? '🔴' : l.level === 'success' ? '🟢' : l.level === 'warning' ? '🟡' : '🔵'} ${l.text}`).join('\n');
      return `📜 آخر السجلات:\n${logs || 'لا سجلات بعد'}`;
    }
    case '/tasks': {
      const active = db.tasks.filter(t => !t.done);
      if (!active.length) return { text: '✅ لا مهام نشطة. أضف مهمة: /addtask عنوان | تاريخ | أولوية', reply_markup: MAIN_KB };
      const text = `✅ المهام النشطة (${active.length}):\n` + active.slice(0, 10).map((t, i) => `${i + 1}. ${t.title}${t.due ? ' 📅' + t.due : ''}${t.priority ? ' [' + t.priority + ']' : ''}`).join('\n');
      const kb = active.slice(0, 10).map((t, i) => [{ text: '✅ إنجاز ' + (i + 1), callback_data: 'done:' + t.id }, { text: '🗑 حذف ' + (i + 1), callback_data: 'del:' + t.id }]);
      return { text, reply_markup: { inline_keyboard: kb } };
    }
    case '/addtask': {
      const parts = args.split('|').map(s => s.trim());
      if (!parts[0]) return '⚠️ الصيغة: /addtask عنوان | تاريخ | أولوية';
      db.tasks.unshift({ id: Date.now().toString(), title: parts[0], due: parts[1] || '', priority: parts[2] || 'متوسطة', done: false, createdAt: new Date().toISOString() });
      saveDB(); addLog('success', '➕ مهمة جديدة عبر البوت: ' + parts[0]);
      return { text: `✅ تمت إضافة المهمة: ${parts[0]}`, reply_markup: { inline_keyboard: [[{ text: '📋 عرض المهام', callback_data: 'list:tasks' }]] } };
    }
    case '/done': {
      const idx = parseInt(args); const active = db.tasks.filter(t => !t.done);
      if (!idx || idx < 1 || idx > active.length) return '⚠️ رقم غير صالح. اعرض /tasks لمعرفة الأرقام';
      active[idx - 1].done = true; saveDB();
      return `✅ تم إنجاز: ${active[idx - 1].title}`;
    }
    case '/deltask': {
      const idx = parseInt(args); const active = db.tasks.filter(t => !t.done);
      if (!idx || idx < 1 || idx > active.length) return '⚠️ رقم غير صالح.';
      const t = active[idx - 1]; db.tasks = db.tasks.filter(x => x.id !== t.id); saveDB();
      return `🗑 تم حذف: ${t.title}`;
    }
    case '/addclient': {
      const parts = args.split('|').map(s => s.trim());
      if (!parts[0]) return '⚠️ الصيغة: /addclient الاسم | المعرف | الهاتف';
      const { client, isNew } = upsertClient({ fullName: parts[0], nationalId: parts[1] || '', phone: parts[2] || '', docType: 'إدخال يدوي' }, 'بوت تلغرام 🤖');
      const rem = scheduleReminder(client, chatId);
      addLog('success', (isNew ? '🆕 عميل عبر البوت: ' : '🔄 تحديث عميل: ') + parts[0]);
      return { text: clientCardText(client, isNew, rem), reply_markup: { inline_keyboard: [[{ text: '🧾 عرض العملاء', callback_data: 'list:clients' }], [{ text: '❌ إلغاء التذكير', callback_data: 'cancelrem:' + rem.id }]] } };
    }
    case '/clients': {
      if (!db.clients.length) return '🧾 لا عملاء بعد. أرسل صورة مستند 📷 أو /addclient';
      const list = db.clients.slice(0, 12).map((c, i) => `${i + 1}. ${c.fullName || 'بدون اسم'}${c.nationalId ? ' — ' + c.nationalId : ''}${c.phone ? ' 📞' + c.phone : ''}`).join('\n');
      return { text: `🧾 العملاء (${db.clients.length}):\n${list}`, reply_markup: { inline_keyboard: db.clients.slice(0, 6).map(c => [{ text: '👤 ' + (c.fullName || c.nationalId || 'عميل').slice(0, 28), callback_data: 'client:' + c.id }]) } };
    }
    case '/reminders': {
      const pend = db.reminders.filter(r => !r.sent);
      const sent = db.reminders.filter(r => r.sent).slice(0, 3);
      let text = `⏰ التذكيرات:\n🔔 مدة التذكير الحالية: ${db.settings.reminderHours} ساعة (تُغيَّر من إعدادات التطبيق)\n\n`;
      text += pend.length ? 'القادمة:\n' + pend.slice(0, 8).map((r, i) => `${i + 1}. 🧾 ${r.clientName} — متبقٍ ${Math.max(1, Math.round((r.at - Date.now()) / 60000))} دقيقة`).join('\n') : 'لا تذكيرات قادمة';
      if (sent.length) text += '\n\nالمرسلة مؤخراً:\n' + sent.map(r => `✔️ ${r.clientName}`).join('\n');
      return { text, reply_markup: pend.length ? { inline_keyboard: pend.slice(0, 5).map((r, i) => [{ text: '❌ إلغاء تذكير ' + r.clientName.slice(0, 20), callback_data: 'cancelrem:' + r.id }]) } : MAIN_KB };
    }
    case '/cancelreminder': {
      const idx = parseInt(args); const pend = db.reminders.filter(r => !r.sent);
      if (!idx || idx < 1 || idx > pend.length) return '⚠️ رقم غير صالح. اعرض /reminders';
      const r = pend[idx - 1]; db.reminders = db.reminders.filter(x => x.id !== r.id); saveDB();
      return `❌ تم إلغاء تذكير: ${r.clientName}`;
    }
    case '/search': {
      if (!args.trim()) return '⚠️ الصيغة: /search كلمة';
      const q = args.trim().toLowerCase();
      const cHits = db.clients.filter(c => JSON.stringify(c).toLowerCase().includes(q)).slice(0, 5)
        .map(c => `🧾 ${c.fullName || ''}${c.nationalId ? ' — ' + c.nationalId : ''}`);
      const tHits = db.tasks.filter(t => JSON.stringify(t).toLowerCase().includes(q)).slice(0, 5)
        .map(t => `${t.done ? '✅' : '⏳'} ${t.title}`);
      return `🔍 نتائج البحث عن "${args.trim()}":\n${[...cHits, ...tHits].join('\n') || 'لا نتائج'}`;
    }
    case '/users': {
      if (!requireAdmin(user)) return '⛔ للمدير فقط';
      return `👥 المستخدمون:\n` + (db.users.map(u => `${u.id} — ${u.username || 'بدون'} ${u.blocked ? '🚫' : u.authed ? '✅' : '🔒'}${db.settings.adminId === u.id ? ' 👑' : ''}`).join('\n') || 'لا مستخدمين');
    }
    case '/admin': {
      if (!db.settings.adminId) { db.settings.adminId = user.id; saveDB(); return '👑 تم تعيينك مديراً للبوت!'; }
      return requireAdmin(user) ? '👑 أنت المدير بالفعل' : '⛔ يوجد مدير آخر';
    }
    case '/block': {
      if (!requireAdmin(user)) return '⛔ للمدير فقط';
      const t = db.users.find(u => u.id === parseInt(args)); if (!t) return '⚠️ مستخدم غير موجود';
      t.blocked = true; saveDB(); return `🚫 تم حظر ${t.username || t.id}`;
    }
    case '/unblock': {
      if (!requireAdmin(user)) return '⛔ للمدير فقط';
      const t = db.users.find(u => u.id === parseInt(args)); if (!t) return '⚠️ مستخدم غير موجود';
      t.blocked = false; saveDB(); return `✅ تم إلغاء حظر ${t.username || t.id}`;
    }
    case '/broadcast': {
      if (!requireAdmin(user)) return '⛔ للمدير فقط';
      if (!args.trim()) return '⚠️ الصيغة: /broadcast رسالتك';
      let sent = 0;
      for (const u of db.users.filter(u => !u.blocked && u.authed)) { try { await tgCall(token, 'sendMessage', { chat_id: u.id, text: '📢 ' + args }); sent++; } catch (e) {} }
      return `📢 تم الإرسال إلى ${sent} مستخدم`;
    }
    case '/notify': {
      if (!requireAdmin(user)) return '⛔ للمدير فقط';
      addLog('warning', '🔔 تنبيه من المدير: ' + args); saveDB();
      return '🔔 تم إرسال التنبيه إلى لوحة التحكم';
    }
    case '/newtoken': {
      if (!requireAdmin(user)) return '⛔ للمدير فقط';
      db.settings.accessToken = 'COA-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      db.users.forEach(u => u.authed = false); user.authed = true; saveDB();
      addLog('warning', '🔐 تم توليد رمز أمان جديد — أُلغيت كل الجلسات');
      return '🔐 رمز جديد: ' + db.settings.accessToken + '\n⚠️ أُلغيت صلاحيات الجميع. شارك الرمز الجديد فقط مع من تثق به.';
    }
    default: return { text: '❓ أمر غير معروف. اختر من الأزرار:', reply_markup: MAIN_KB };
  }
}

// ─── Bot update processor (Long Polling) ───
async function processUpdate(token, u) {
  // أزرار inline
  if (u.callback_query) {
    const cq = u.callback_query;
    const user = db.users.find(x => x.id === cq.from.id);
    if (!user || !user.authed || user.blocked) { await tgCall(token, 'answerCallbackQuery', { callback_query_id: cq.id, text: '🔒 غير مصرّح' }); return; }
    const [act, val] = (cq.data || '').split(':');
    let msg = '';
    if (act === 'done') { const t = db.tasks.find(x => x.id === val); if (t) { t.done = true; msg = '✅ تم إنجاز: ' + t.title; } }
    else if (act === 'del') { const t = db.tasks.find(x => x.id === val); if (t) { db.tasks = db.tasks.filter(x => x.id !== val); msg = '🗑 تم حذف: ' + t.title; } }
    else if (act === 'cancelrem') { const r = db.reminders.find(x => x.id === val); if (r) { db.reminders = db.reminders.filter(x => x.id !== val); msg = '❌ أُلغي تذكير: ' + r.clientName; } }
    else if (act === 'client') { const c = db.clients.find(x => x.id === val); if (c) msg = clientCardText(c, false, null); }
    else if (act === 'list' && val === 'tasks') { msg = 'استعمل زر ✅ المهام'; }
    else if (act === 'list' && val === 'clients') { msg = 'استعمل زر 🧾 العملاء'; }
    saveDB();
    await tgCall(token, 'answerCallbackQuery', { callback_query_id: cq.id, text: msg.slice(0, 180) || 'تم ✅' });
    if (msg && (act === 'client')) await botReply(token, cq.message.chat.id, msg);
    return;
  }
  const msg = u.message;
  if (!msg) return;

  // تسجيل المستخدم
  let user = db.users.find(x => x.id === msg.from.id);
  if (!user) {
    user = { id: msg.from.id, username: msg.from.username || msg.from.first_name || 'user', blocked: false, authed: false, lastSeen: new Date().toISOString(), messages: 0 };
    db.users.unshift(user); saveDB();
    addLog('system', '👤 مستخدم تلغرام جديد: ' + user.username);
  }
  user.lastSeen = new Date().toISOString(); user.messages++;
  const chatId = msg.chat.id;
  if (user.blocked) { await botReply(token, chatId, '🚫 أنت محظور من استعمال هذا البوت.'); return; }

  // المصادقة بالرمز
  const text = (msg.text || '').trim();
  if (!user.authed) {
    if (text.startsWith('/auth')) {
      const tok = text.split(/\s+/)[1] || '';
      if (tok && tok === db.settings.accessToken) {
        user.authed = true; saveDB();
        addLog('success', '🔐 تفعيل وصول: ' + user.username);
        await botReply(token, chatId, { text: '🔓 تم تفعيل وصولك بنجاح!\nيمكنك الآن استعمال كل وظائف البوت — أرسل صورة مستند 📷 وسأستخرج بياناته وأنشئ ملف عميل مع تذكير تلقائي.', reply_markup: MAIN_KB });
      } else {
        addLog('warning', '🔒 محاولة دخول برمز خاطئ من ' + user.username);
        await botReply(token, chatId, '❌ رمز غير صحيح.\nانسخ الرمز من إعدادات التطبيق (🔐 رمز أمان البوت) وأرسله هكذا:\n/auth الرمز');
      }
    } else {
      await botReply(token, chatId, '🔒 هذا البوت محمي.\nللوصول أرسل:\n/auth رمز-الدخول\n\nستجد الرمز في التطبيق ← الإعدادات ← رمز أمان البوت 🔐');
    }
    return;
  }

  // 📷 استقبال صورة → OCR → عميل + تذكير
  if (msg.photo) {
    await botReply(token, chatId, '⏳ جارٍ تحليل الصورة بالذكاء الاصطناعي...');
    try {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const f = await tgCall(token, 'getFile', { file_id: fileId });
      if (!f.ok) throw new Error('تعذر جلب الملف');
      const url = `https://api.telegram.org/file/bot${token}/${f.result.file_path}`;
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      const { client, isNew, reminder } = await processImageToClient(buf.toString('base64'), 'image/jpeg', 'بوت تلغرام 📷', chatId);
      await botReply(token, chatId, { text: clientCardText(client, isNew, reminder), reply_markup: { inline_keyboard: [[{ text: '👤 عرض الملف', callback_data: 'client:' + client.id }], [{ text: '❌ إلغاء التذكير', callback_data: 'cancelrem:' + reminder.id }]] } });
    } catch (e) {
      addLog('error', '📷 فشل تحليل صورة: ' + e.message);
      await botReply(token, chatId, '❌ ' + e.message);
    }
    return;
  }
  if (!text) return;

  // الأزرار والإجراءات المعلقة
  if (pending.has(user.id) && !text.startsWith('/')) {
    const p = pending.get(user.id); pending.delete(user.id);
    const reply = await handleCommand(token, p.action === 'search' ? '/search' : '/addclient', text, user, chatId);
    await botReply(token, chatId, reply); return;
  }
  if (text === '🔍 بحث') { pending.set(user.id, { action: 'search' }); await botReply(token, chatId, '🔎 أرسل كلمة البحث:'); return; }
  if (text === '➕ إضافة عميل') { pending.set(user.id, { action: 'addclient' }); await botReply(token, chatId, '📝 أرسل بالصيغة:\nالاسم | المعرف | الهاتف'); return; }
  const mapped = BTN[text];

  // تنفيذ الأمر
  const parts = text.split(' ');
  const cmd = (mapped || parts[0].split('@')[0]).toLowerCase();
  const args = mapped ? '' : parts.slice(1).join(' ');
  const t0 = Date.now();
  try {
    const reply = await handleCommand(token, cmd, args, user, chatId);
    const ms = Date.now() - t0;
    await botReply(token, chatId, typeof reply === 'string' ? { text: reply, reply_markup: MAIN_KB } : reply);
    addLog('system', `🤖 ${cmd} من ${user.username} (${ms}ms)`);
  } catch (e) {
    addLog('error', `❌ خطأ في ${cmd}: ${e.message}`);
    await botReply(token, chatId, '❌ حدث خطأ: ' + e.message);
  }
}

async function botFixWebhook(token) {
  try {
    const info = await tgCall(token, 'getWebhookInfo', {});
    if (info.ok && info.result && info.result.url) {
      await tgCall(token, 'deleteWebhook', { drop_pending_updates: true });
      addLog('system', '🔧 تم حذف webhook قديم كان يمنع استقبال الرسائل');
    }
  } catch (e) { addLog('warning', '⚠️ تعذر فحص webhook: ' + e.message); }
}

async function botLoop(token) {
  while (botRunning) {
    try {
      const r = await tgCall(token, 'getUpdates', { offset: lastUpdateId + 1, limit: 50, timeout: 25 });
      if (!r.ok) {
        botFailCount++;
        if (r.error_code === 409) { await botFixWebhook(token); lastUpdateId = -1; }
        if (r.error_code === 401) { addLog('error', '❌ توكن بوت تلغرام غير صالح!'); stopBot(); break; }
        if (botFailCount >= 3) addLog('warning', `⚠️ البوت يواجه مشاكل (${r.error_code || 'شبكة'})`);
        await sleep(3000); continue;
      }
      botFailCount = 0;
      for (const u of r.result || []) {
        if (u.update_id > lastUpdateId) lastUpdateId = u.update_id;
        try { await processUpdate(token, u); } catch (e) { addLog('error', '❌ خطأ معالجة: ' + e.message); }
      }
    } catch (e) { await sleep(3000); }
  }
}

async function startBot() {
  if (botRunning || !db.settings.telegramBotToken) return;
  botRunning = true; lastUpdateId = -1; botFailCount = 0;
  const token = db.settings.telegramBotToken;
  try {
    await botFixWebhook(token);
    const me = await tgCall(token, 'getMe', {});
    if (me.ok) addLog('success', `🤖 بوت تلغرام متصل (Long Polling): @${me.result.username}`);
    else if (me.error_code === 401) { addLog('error', '❌ توكن بوت تلغرام غير صالح!'); stopBot(); return; }
  } catch (e) { addLog('warning', '⚠️ مشكلة اتصال بتلغرام: ' + e.message); }
  addLog('system', '🤖 بدأ بوت تلغرام (وضع سريع)');
  botLoop(token);
}
function stopBot() { botRunning = false; addLog('system', '⏹️ توقف بوت تلغرام'); }

// ─── Reminder engine ───
setInterval(async () => {
  const due = db.reminders.filter(r => !r.sent && r.at <= Date.now());
  if (!due.length) return;
  const token = db.settings.telegramBotToken;
  for (const r of due) {
    const c = db.clients.find(x => x.id === r.clientId);
    const text = `⏰ تذكير بملف عميل!\n\n🧾 ${r.clientName}${c && c.nationalId ? '\n🆔 ' + c.nationalId : ''}${c && c.phone ? '\n📞 ' + c.phone : ''}\n📄 ${(c && c.docType) || ''}\n\nتم إنشاء/تحديث هذا الملف قبل ${r.hours} ساعة — تفقد ملفه في التطبيق.`;
    const targets = r.chatId ? [r.chatId] : db.users.filter(u => u.authed && !u.blocked).map(u => u.id);
    if (token) for (const cid of targets) { try { await tgCall(token, 'sendMessage', { chat_id: cid, text }); } catch (e) {} }
    r.sent = true;
    addLog('warning', '⏰ أُرسل تذكير بملف: ' + r.clientName);
  }
  saveDB();
}, 30000);

// ─── Static ───
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// ─── Kimi chat ───
async function kimiChat(apiKey, model, message) {
  const payload = { model, messages: [{ role: 'system', content: 'أنت مساعد Claw Office AI الذكي، تجيب بالعربية باختصار ومهنية.' }, { role: 'user', content: message }], temperature: 0.6 };
  const hosts = ['https://api.moonshot.ai/v1/chat/completions', 'https://api.moonshot.cn/v1/chat/completions'];
  let lastErr = '';
  for (const url of hosts) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || ('HTTP ' + res.status));
      return { reply: data.choices?.[0]?.message?.content || 'لا رد' };
    } catch (e) { lastErr = e.message; }
  }
  throw new Error(lastErr);
}

// ─── API ───
async function handleAPI(req, res, url) {
  const p = url.pathname;
  const json = (d, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(d)); };
  if (req.method === 'GET' && p === '/api/health') return json({ ok: true, version: APP_VERSION });
  if (req.method === 'GET' && p === '/api/version') return json({ version: APP_VERSION });
  if (req.method === 'GET' && p === '/api/stats') {
    const today = new Date().toDateString();
    return json({
      messagesToday: db.logs.filter(l => new Date(l.at).toDateString() === today).length,
      activeUsers: db.users.filter(u => !u.blocked).length,
      clients: db.clients.length,
      pendingTasks: db.tasks.filter(t => !t.done).length,
      tasks: db.tasks.length,
      pendingReminders: db.reminders.filter(r => !r.sent).length,
      dataSize: (fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0),
      learning: 85
    });
  }
  if (req.method === 'GET' && p === '/api/tasks') return json(db.tasks);
  if (req.method === 'GET' && p === '/api/clients') return json(db.clients);
  if (req.method === 'GET' && p === '/api/clients/latest') return json(db.clients[0] || null);
  if (req.method === 'GET' && p === '/api/logs') return json(db.logs.slice(0, 50));
  if (req.method === 'GET' && p === '/api/users') return json(db.users.map(u => ({ id: u.id, username: u.username, blocked: u.blocked, authed: u.authed, lastSeen: u.lastSeen })));
  if (req.method === 'GET' && p === '/api/reminders') return json(db.reminders.slice(0, 50));
  if (req.method === 'GET' && p === '/api/settings') return json({ ...db.settings, hasKimiKey: !!db.settings.kimiApiKey, kimiApiKey: db.settings.kimiApiKey ? '••••' + db.settings.kimiApiKey.slice(-4) : '' });
  if (req.method === 'POST' && p === '/api/settings') {
    const b = await readBody(req);
    if (b.telegramBotToken) { const changed = b.telegramBotToken !== db.settings.telegramBotToken; db.settings.telegramBotToken = b.telegramBotToken; if (changed) { stopBot(); setTimeout(startBot, 500); } }
    if (b.kimiApiKey) db.settings.kimiApiKey = b.kimiApiKey;
    if (b.kimiModel) db.settings.kimiModel = b.kimiModel;
    if (b.reminderHours !== undefined && !isNaN(parseFloat(b.reminderHours))) db.settings.reminderHours = Math.min(168, Math.max(0.25, parseFloat(b.reminderHours)));
    saveDB(); addLog('system', '⚙️ تم تحديث الإعدادات'); return json({ ok: true });
  }
  if (req.method === 'POST' && p === '/api/token/regen') {
    db.settings.accessToken = 'COA-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    db.users.forEach(u => u.authed = false); saveDB();
    addLog('warning', '🔐 رمز أمان جديد من التطبيق — أُلغيت كل جلسات البوت');
    return json({ ok: true, token: db.settings.accessToken });
  }
  if (req.method === 'POST' && p === '/api/bot/restart') { stopBot(); setTimeout(startBot, 1000); return json({ ok: true, message: 'جارٍ إعادة تشغيل البوت...' }); }
  if (req.method === 'POST' && p === '/api/telegram/test') {
    const token = db.settings.telegramBotToken;
    if (!token) return json({ ok: false, error: 'أدخل رمز البوت أولاً' }, 400);
    try { const me = await tgCall(token, 'getMe', {}); if (me.ok) return json({ ok: true, bot: me.result }); return json({ ok: false, error: me.description || 'توكن غير صالح' }); }
    catch (e) { return json({ ok: false, error: e.message }); }
  }
  if (req.method === 'POST' && p === '/api/telegram/send') {
    const b = await readBody(req);
    const token = db.settings.telegramBotToken;
    if (!token) return json({ ok: false, error: 'أدخل رمز البوت أولاً' }, 400);
    if (!b.chatId || !b.text) return json({ ok: false, error: 'معرف الدردشة والنص مطلوبان' }, 400);
    try { const r = await tgCall(token, 'sendMessage', { chat_id: b.chatId, text: String(b.text).slice(0, 4000) }); if (r.ok) { addLog('success', '📨 رسالة إلى ' + b.chatId); return json({ ok: true }); } return json({ ok: false, error: r.description || 'فشل الإرسال' }); }
    catch (e) { return json({ ok: false, error: e.message }); }
  }
  if (req.method === 'GET' && p === '/api/telegram/updates') {
    return json({ ok: true, messages: db.users.slice(0, 10).map(u => ({ from: u.username, chatId: u.id, date: timeAgoStr(u.lastSeen) })) });
  }
  if (req.method === 'GET' && p === '/api/telegram/bot-status') return json({ running: botRunning });
  if (req.method === 'POST' && p === '/api/telegram/bot') {
    const b = await readBody(req);
    if (b.action === 'start') {
      if (!db.settings.telegramBotToken) return json({ ok: false, error: 'أدخل رمز البوت واحفظه أولاً' }, 400);
      stopBot(); setTimeout(startBot, 300); return json({ ok: true });
    }
    if (b.action === 'stop') { stopBot(); return json({ ok: true }); }
    return json({ ok: false, error: 'إجراء غير معروف' }, 400);
  }
  if (req.method === 'POST' && p === '/api/search') {
    const b = await readBody(req);
    const q = String(b.q || '').trim().toLowerCase();
    if (!q) return json({ results: [] });
    const results = [];
    for (const c of db.clients) if (JSON.stringify(c).toLowerCase().includes(q)) results.push({ name: c.fullName || 'عميل', type: 'عميل 🧾', detail: [c.nationalId, c.phone, c.address].filter(Boolean).join(' • ') });
    for (const t of db.tasks) if (JSON.stringify(t).toLowerCase().includes(q)) results.push({ name: t.title, type: t.done ? 'مهمة ✅' : 'مهمة ⏳', detail: t.due || '' });
    for (const l of db.logs) if (results.length < 20 && String(l.text).toLowerCase().includes(q)) results.push({ name: l.text, type: 'سجل 📜', detail: l.level });
    return json({ results: results.slice(0, 20) });
  }
  if (req.method === 'POST' && p === '/api/chat') {
    const b = await readBody(req);
    if (!db.settings.kimiApiKey) return json({ error: 'لم يتم ضبط مفتاح Kimi API. أضفه من الإعدادات ⚙️' }, 400);
    try { const r = await kimiChat(db.settings.kimiApiKey, db.settings.kimiModel || 'kimi-k2.5', b.message); return json(r); }
    catch (e) { return json({ error: 'خطأ Kimi: ' + e.message }, 500); }
  }
  if (req.method === 'POST' && p === '/api/tasks') {
    const b = await readBody(req);
    if (!b.title || !String(b.title).trim()) return json({ error: 'العنوان مطلوب' }, 400);
    const t = { id: Date.now().toString(), title: String(b.title).slice(0, 200), due: b.due || '', priority: b.priority || 'متوسطة', done: false, createdAt: new Date().toISOString() };
    db.tasks.unshift(t); saveDB(); addLog('success', '➕ مهمة جديدة: ' + t.title); return json(t, 201);
  }
  if (req.method === 'POST' && p === '/api/tasks/toggle') {
    const b = await readBody(req);
    const t = db.tasks.find(x => x.id === b.id);
    if (!t) return json({ error: 'غير موجودة' }, 404);
    t.done = !t.done; saveDB(); addLog('success', (t.done ? '✅ أُنجزت: ' : '↩️ أُعيد فتح: ') + t.title); return json(t);
  }
  if (req.method === 'DELETE' && p.startsWith('/api/tasks/')) {
    const id = p.split('/').pop();
    const t = db.tasks.find(x => x.id === id);
    db.tasks = db.tasks.filter(x => x.id !== id); saveDB();
    if (t) addLog('warning', '🗑️ حُذفت مهمة: ' + t.title);
    return json({ ok: true });
  }
  if (req.method === 'POST' && p === '/api/clients') {
    const b = await readBody(req);
    const { client, isNew } = upsertClient(b, 'التطبيق 🖥️');
    const rem = scheduleReminder(client, null);
    addLog('success', (isNew ? '🆕 عميل جديد: ' : '🔄 تحديث عميل: ') + (client.fullName || client.nationalId));
    return json({ ...client, isNew, reminderAt: rem.at }, isNew ? 201 : 200);
  }
  if (req.method === 'POST' && p === '/api/ocr') {
    const b = await readBody(req);
    if (!b.image) return json({ error: 'الصورة مطلوبة' }, 400);
    if (!db.settings.kimiApiKey) return json({ error: 'اضبط مفتاح Kimi API من الإعدادات أولاً ⚙️' }, 400);
    try {
      const { client, isNew, reminder } = await processImageToClient(b.image, b.mime || 'image/jpeg', 'التطبيق 🖥️', null);
      db.settings.lastOcr = { ...client, at: new Date().toISOString() }; saveDB();
      return json({ client, isNew, reminderAt: reminder.at, reminderHours: reminder.hours });
    } catch (e) { return json({ error: e.message }, 500); }
  }
  if (req.method === 'POST' && p === '/api/users/toggle-block') {
    const b = await readBody(req);
    const u = db.users.find(x => x.id === b.id);
    if (!u) return json({ error: 'غير موجود' }, 404);
    u.blocked = !u.blocked; saveDB(); addLog('warning', (u.blocked ? '🚫 حُظر: ' : '✅ أُلغي حظر: ') + u.username); return json(u);
  }
  if (req.method === 'DELETE' && p === '/api/logs') { db.logs = []; saveDB(); return json({ ok: true }); }
  json({ error: 'Not found' }, 404);
}
function readBody(req) { return new Promise(r => { let d = ''; req.on('data', c => { d += c; if (d.length > 30e6) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch (e) { r({}); } }); }); }

// ─── Server ───
const REQ_LOG_LIMIT = 200;
const server = http.createServer(async (req, res) => {
  const t0 = Date.now(); const url = new URL(req.url, 'http://x');
  res.on('finish', () => {
    const ms = Date.now() - t0;
    const skip = url.pathname.startsWith('/api/logs');
    if (!skip || ms > 1000) console.log(`${ms > 1000 ? '🐢' : '⚡'} ${req.method} ${url.pathname} → ${res.statusCode} (${ms}ms)`);
  });
  try {
    if (url.pathname.startsWith('/api/')) return await handleAPI(req, res, url);
    let f = path.normalize(url.pathname === '/' ? '/index.html' : url.pathname);
    if (f.includes('..')) { res.writeHead(403); return res.end(); }
    const fp = path.join(PUBLIC_DIR, f);
    if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
      const idx = path.join(PUBLIC_DIR, 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      return res.end(fs.readFileSync(idx));
    }
    let cache = 'public, max-age=86400';
    if (f.endsWith('.html')) cache = 'no-cache, no-store, must-revalidate';
    else if (url.search.includes('v=')) cache = 'public, max-age=31536000, immutable';
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': cache });
    fs.createReadStream(fp).pipe(res);
  } catch (e) { res.writeHead(500); res.end('Server error'); }
});

server.listen(PORT, () => {
  const sep = '═'.repeat(40);
  console.log('\n╔' + sep + '╗');
  console.log('║   🚀 Claw Office AI v' + APP_VERSION + ' — يعمل الآن      ║');
  console.log('╚' + sep + '╝');
  console.log('🌐 الرابط:        http://localhost:' + PORT);
  console.log('🔑 مفتاح Kimi:    ' + (db.settings.kimiApiKey ? '✅ مضبوط' : '❌ غير مضبوط (الإعدادات)'));
  console.log('🤖 بوت تلغرام:    ' + (db.settings.telegramBotToken ? '⏳ جارٍ الاتصال...' : '❌ غير مضبوط (الإعدادات)'));
  console.log('🔐 رمز أمان البوت: ' + db.settings.accessToken);
  console.log('🔔 مدة التذكير:    ' + db.settings.reminderHours + ' ساعة');
  console.log('💾 قاعدة البيانات: ' + db.clients.length + ' عميل، ' + db.tasks.length + ' مهمة');
  console.log(sep);
  console.log('📡 سجل الطلبات المباشر (آخر ' + REQ_LOG_LIMIT + '):');
  startBot();
});
