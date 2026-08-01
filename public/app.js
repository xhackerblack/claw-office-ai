// Claw Office AI v3.0 — منطق الواجهة
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ─── أمان: تهريب HTML لمنع حقن XSS ───
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function timeAgo(iso) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'الآن'; if (m < 60) return `منذ ${m} دقيقة`;
  const h = Math.floor(m / 60); if (h < 24) return `منذ ${h} ساعة`;
  return `منذ ${Math.floor(h / 24)} يوم`;
}

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ─── التنقل ───
function go(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  const target = $('#' + id);
  if (!target) return;
  target.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.go === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (id === 'screen-client') loadClientScreen();
  if (id === 'screen-settings') loadReminders();
}
$$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));

// ─── لوحة التحكم ───
async function loadStats() {
  try {
    const s = await api('/api/stats');
    $('#learning-pct').textContent = s.learning + '%';
    $('#kb-size').innerHTML = `${(s.dataSize / 1024).toFixed(1)} <small>كيلوبايت</small>`;
    $('#msg-today').textContent = s.messagesToday.toLocaleString('ar-MA');
    $('#active-users').textContent = s.activeUsers.toLocaleString('ar-MA');
    const rc = $('#rep-clients'); if (rc) { rc.textContent = s.clients; $('#rep-tasks').textContent = s.pendingTasks; $('#rep-reminders').textContent = s.pendingReminders; }
  } catch (e) {}
}
$('#live-learning').addEventListener('change', e =>
  toast(e.target.checked ? '⚡ التعلم المباشر مفعّل' : '⏸ التعلم المباشر معطّل'));

async function loadActivity() {
  try {
    const logs = await api('/api/logs');
    const dot = { error: 'red', success: 'green', warning: 'yellow', system: 'cyan' };
    $('#recent-activity').innerHTML = logs.slice(0, 6).map(l =>
      `<div class="list-item"><span class="dot ${dot[l.level] || 'cyan'}"></span><span class="grow">${esc(l.text)}</span><small>${timeAgo(l.at)}</small></div>`
    ).join('') || '<p style="color:var(--muted);font-size:13px;font-weight:600">لا نشاط بعد</p>';
  } catch (e) {}
}

// ─── الدردشة (Kimi) ───
$('#chat-send').addEventListener('click', sendChat);
$('#chat-text').addEventListener('keydown', e => e.key === 'Enter' && sendChat());
async function sendChat() {
  const inp = $('#chat-text');
  if (!inp.value.trim()) return;
  const box = $('#chat-box');
  box.insertAdjacentHTML('beforeend', `<div class="msg me">${esc(inp.value)}</div>`);
  const q = inp.value; inp.value = '';
  box.scrollTop = box.scrollHeight;
  try {
    const r = await api('/api/chat', 'POST', { message: q });
    box.insertAdjacentHTML('beforeend', `<div class="msg ai">${r.error ? '⚠️ ' + esc(r.error) : '🌙 ' + esc(r.reply)}</div>`);
  } catch (e) {
    box.insertAdjacentHTML('beforeend', `<div class="msg ai">⚠️ خطأ في الاتصال بالخادم</div>`);
  }
  box.scrollTop = box.scrollHeight;
}

// ─── مسح مستند (OCR) ───
$('#upload-doc').addEventListener('click', () => $('#doc-file').click());
$('#doc-file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  toast('⏳ جارٍ تحليل الصورة بالذكاء الاصطناعي...');
  const b64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(f); });
  try {
    const r = await api('/api/ocr', 'POST', { image: b64, mime: f.type });
    if (r.error) { toast('❌ ' + r.error); renderExtracted(null); return; }
    renderExtracted(r.client);
    toast((r.isNew ? '✅ ملف عميل جديد أُنشئ' : '🔄 تم تحديث العميل') + ' — 🔔 تذكير بعد ' + r.reminderHours + ' ساعة');
    loadActivity(); loadStats();
  } catch (err) { toast('❌ خطأ في الاتصال'); }
  e.target.value = '';
});
function renderExtracted(c) {
  const box = $('#extracted-data');
  if (!c) { box.innerHTML = '<p style="color:var(--muted);font-size:13px;font-weight:600">تعذر الاستخراج — جرّب صورة أوضح</p>'; return; }
  const rows = [
    ['الاسم الكامل', c.fullName], ['رقم التعريف', c.nationalId], ['تاريخ الميلاد', c.birthDate],
    ['مكان الازدياد', c.birthPlace], ['العنوان', c.address], ['الهاتف', c.phone],
    ['البريد', c.email], ['صالحة إلى', c.expiry], ['نوع المستند', c.docType], ['ملاحظات', c.notes]
  ].filter(([, v]) => v);
  box.innerHTML = rows.map(([k, v]) => `<div class="extracted"><span>${k}</span><b class="hl">${esc(v)}</b></div>`).join('');
}

// ─── شاشة العميل ───
async function loadClientScreen() {
  try {
    const clients = await api('/api/clients');
    const c = clients[0];
    if (!c) {
      $('#client-name').textContent = 'لا عملاء بعد';
      $('#client-avatar').textContent = '؟';
      $('#client-grid').innerHTML = '';
      $('#client-docs').innerHTML = '';
      $('#clients-list').innerHTML = '<p style="color:var(--muted)">امسح مستندًا لإنشاء أول ملف 📷</p>';
      return;
    }
    $('#client-name').textContent = c.fullName || c.nationalId || 'عميل';
    $('#client-avatar').textContent = (c.fullName || '؟')[0];
    const cells = [
      ['رقم التعريف', c.nationalId], ['الاسم الكامل', c.fullName], ['تاريخ الميلاد', c.birthDate],
      ['مكان الازدياد', c.birthPlace], ['الهاتف', c.phone], ['البريد', c.email],
      ['العنوان', c.address], ['الأب', c.father], ['الأم', c.mother], ['صالحة إلى', c.expiry]
    ].filter(([, v]) => v);
    $('#client-grid').innerHTML = cells.map(([k, v]) => `<div class="data-cell"><small>${k}</small><b dir="auto">${esc(v)}</b></div>`).join('');
    $('#client-docs').innerHTML = `<div class="doc-card"><span class="badge green">موثّق</span><div class="big-icon">📄</div><small>${esc(c.docType || 'مستند')}</small></div>`;
    $('#clients-list').innerHTML = clients.slice(0, 8).map(x =>
      `<div class="file-row"><div class="file-icon">👤</div><span class="grow">${esc(x.fullName || 'بدون اسم')}</span><span class="badge ${x.verified ? 'green' : 'orange'}">${esc(x.nationalId || '')}</span></div>`
    ).join('');
  } catch (e) {}
}

// ─── المهام ───
async function loadTasks() {
  try {
    const tasks = await api('/api/tasks');
    $('#tasks-list').innerHTML = tasks.map(t => `
      <div class="task-card ${t.done ? 'READY' : 'PROCESSING'}">
        <div class="task-head">
          <div><b>${esc(t.title)}</b><br><small style="color:var(--muted)">📅 ${esc(t.due || 'بدون موعد')} • ${esc(t.priority || '')}</small></div>
          <span class="status ${t.done ? 'READY' : 'PROCESSING'}">${t.done ? 'منجزة ✅' : 'نشطة'}</span>
        </div>
      </div>`).join('') || '<div class="card center" style="color:var(--muted)">لا مهام — أضفها عبر البوت: /addtask</div>';
  } catch (e) {}
}

// ─── السجلات ───
async function loadLogs(filter = 'all') {
  try {
    const allLogs = await api('/api/logs');
    const list = filter === 'all' ? allLogs : allLogs.filter(l => l.level.toUpperCase().startsWith(filter.slice(0, 4)));
    const html = list.map(l =>
      `<div class="log-entry ${esc(l.level)}">[${esc(l.level)}] ${esc(l.text)} <small>• ${new Date(l.at).toLocaleTimeString('ar-MA')}</small></div>`
    ).join('') || '<div class="log-entry INFO">لا توجد سجلات</div>';
    $('#logs-list').innerHTML = html;
    const sl = $('#status-logs');
    if (sl) sl.innerHTML = allLogs.slice(0, 5).map(l =>
      `<div class="log-entry ${esc(l.level)}">[${esc(l.level)}] ${esc(l.text)}</div>`).join('');
  } catch (e) {}
}
$$('#log-filters .tab').forEach(t => t.addEventListener('click', () => {
  $$('#log-filters .tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active'); loadLogs(t.dataset.f);
}));

// ─── المستخدمون ───
let usersFilter = 'all';
$$('#user-tabs .tab').forEach(t => t.addEventListener('click', () => {
  $$('#user-tabs .tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active'); usersFilter = t.dataset.f; loadUsers();
}));
function userCardHTML(u) {
  return `
  <div class="user-card ${u.blocked ? 'blocked' : ''}">
    <div class="avatar">${esc((u.username || '?')[0].toUpperCase())}</div>
    <div class="user-info">
      <b>${esc(u.username || '')}</b> <span class="badge ${u.blocked ? 'red' : u.authed ? 'green' : 'orange'}">${u.blocked ? 'محظور' : u.authed ? 'مصرّح 🔓' : 'بانتظار الرمز 🔒'}</span>
      <small>المعرف: ${esc(u.id)} • آخر نشاط: ${timeAgo(u.lastSeen)}</small>
    </div>
    <button class="btn small ${u.blocked ? 'neon' : ''}" onclick="toggleBlock(${u.id})">${u.blocked ? 'إلغاء الحظر' : 'حظر'}</button>
  </div>`;
}
async function loadUsers() {
  try {
    const users = await api('/api/users');
    const q = ($('#user-search').value || '').toLowerCase();
    const filtered = users
      .filter(u => usersFilter === 'all' || u.blocked)
      .filter(u => !q || (u.username || '').toLowerCase().includes(q));
    $('#users-list').innerHTML = filtered.map(userCardHTML).join('') ||
      '<div class="card center" style="color:var(--muted)">لا يوجد مستخدمون بعد — فعّلوا البوت برمز الأمان</div>';
    $('#users-mini').innerHTML = users.slice(0, 3).map(userCardHTML).join('');
  } catch (e) {}
}
window.toggleBlock = async id => {
  const u = await api('/api/users/toggle-block', 'POST', { id });
  toast(u.blocked ? `🚫 تم حظر ${u.username}` : `✅ تم إلغاء حظر ${u.username}`);
  loadUsers(); loadLogs();
};
$('#user-search').addEventListener('input', loadUsers);

// ─── البحث العميق ───
let searchTimer;
$('#deep-search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = e.target.value.trim();
    if (!q) { $('#search-results').innerHTML = ''; return; }
    const results = await api('/api/search', 'POST', { q });
    const hl = s => esc(s || '').replace(new RegExp(escRe(q), 'gi'), m => `<mark>${m}</mark>`);
    $('#search-results').innerHTML = (results.results || []).map(r => `
      <div class="result-card">
        <b>${hl(r.name)}</b> <span class="badge cyan">${r.type}</span>
        <small>${hl(r.detail)}</small>
      </div>`).join('') || '<div class="card center" style="color:var(--muted)">لا توجد نتائج</div>';
  }, 350);
});

// ─── الرسم البياني ───
(function drawChart() {
  const el = $('#bar-chart'); if (!el) return;
  const data = [['W1', 55], ['W2', 62], ['W3', 80], ['W4', 95]];
  el.innerHTML = data.map(([w, v]) =>
    `<div class="col-wrap"><div class="col" style="height:${v}%"></div><small>${w}</small></div>`).join('');
})();

// ─── التدريب ───
$('#conf-range')?.addEventListener('input', e => $('#conf-val').textContent = e.target.value + '%');

// ─── الإعدادات ───
async function saveSettings() {
  await api('/api/settings', 'POST', {
    telegramBotToken: $('#tg-token').value,
    kimiApiKey: $('#kimi-key').value,
    kimiModel: $('#kimi-model').value,
  });
}
async function loadSettings() {
  try {
    const s = await api('/api/settings');
    if (s.telegramBotToken) { $('#tg-token').value = s.telegramBotToken; setBadge('#tg-badge', true); }
    if (s.kimiApiKey) { $('#kimi-key').placeholder = s.kimiApiKey; setBadge('#kimi-badge', true); }
    if (s.kimiModel) $('#kimi-model').value = s.kimiModel;
    $('#access-token').value = s.accessToken || '';
    if (s.reminderHours) { $('#rem-range').value = Math.min(48, Math.max(1, s.reminderHours)); $('#rem-val').textContent = s.reminderHours + ' ساعة'; }
  } catch (e) {}
}
function setBadge(sel, connected) {
  const b = $(sel);
  b.className = 'badge ' + (connected ? 'green' : 'orange');
  b.textContent = connected ? 'متصل' : 'غير متصل';
}
function showStatus(el, ok, msg) {
  el.innerHTML = `<span class="badge ${ok ? 'green' : 'red'}" style="font-size:12px">${ok ? '✅' : '❌'} ${msg}</span>`;
}

$('#cf-deploy')?.addEventListener('click', () => toast('☁ النشر يتم يدوياً من Termux'));
$('#gh-sync')?.addEventListener('click', () => toast('⌥ المزامنة عبر git pull في Termux'));

// ─── رمز الأمان ───
$('#token-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#access-token').value); toast('📋 تم نسخ الرمز — أرسله للبوت: /auth ' + $('#access-token').value); }
  catch (e) { $('#access-token').select(); document.execCommand('copy'); toast('📋 تم النسخ'); }
});
$('#token-regen').addEventListener('click', async () => {
  if (!confirm('توليد رمز جديد سيلغي صلاحية كل مستخدمي البوت الحاليين. متابعة؟')) return;
  const r = await api('/api/token/regen', 'POST', {});
  if (r.ok) { $('#access-token').value = r.token; toast('🔐 رمز جديد: ' + r.token); loadLogs(); }
});

// ─── مدة التذكير ───
$('#rem-range').addEventListener('input', e => $('#rem-val').textContent = e.target.value + ' ساعة');
$('#rem-save').addEventListener('click', async () => {
  await api('/api/settings', 'POST', { reminderHours: parseFloat($('#rem-range').value) });
  toast('💾 تم حفظ مدة التذكير: ' + $('#rem-range').value + ' ساعة'); loadReminders(); loadLogs();
});
async function loadReminders() {
  try {
    const rems = await api('/api/reminders');
    const pend = rems.filter(r => !r.sent);
    $('#reminders-list').innerHTML = pend.map(r =>
      `<div class="list-item"><span class="dot yellow"></span><span class="grow">🧾 ${esc(r.clientName)}</span><small>بعد ${Math.max(1, Math.round((r.at - Date.now()) / 60000))} دقيقة</small></div>`
    ).join('') || '<p style="color:var(--muted);font-size:13px;font-weight:600">لا تذكيرات قادمة</p>';
  } catch (e) {}
}

// ─── تلغرام ───
$('#tg-test').addEventListener('click', async () => {
  await saveSettings();
  const st = $('#tg-status'); showStatus(st, true, 'جارٍ الاختبار...');
  const r = await api('/api/telegram/test', 'POST', {});
  showStatus(st, r.ok, r.ok ? `متصل بالبوت @${r.bot.username}` : `خطأ: ${r.error}`);
  setBadge('#tg-badge', r.ok);
  toast(r.ok ? `✈️ متصل بـ @${r.bot.username}` : `❌ ${r.error}`);
  loadLogs();
});
$('#tg-send').addEventListener('click', async () => {
  const r = await api('/api/telegram/send', 'POST', { chatId: $('#tg-chatid').value, text: $('#tg-msg').value });
  toast(r.ok ? '📨 تم إرسال الرسالة بنجاح' : `❌ ${r.error}`);
  if (r.ok) $('#tg-msg').value = '';
  loadLogs();
});
$('#tg-updates').addEventListener('click', async () => {
  const r = await api('/api/telegram/updates');
  if (!r.ok) { toast(`❌ ${r.error}`); loadLogs(); return; }
  $('#tg-messages').innerHTML = r.messages.map(m => `
    <div class="list-item"><span class="dot cyan"></span>
      <span class="grow"><b>@${esc(m.from)}</b> (${esc(m.chatId)})<br><small>${esc(m.date)}</small></span>
    </div>`).join('') || '<small style="color:var(--muted)">لا رسائل — أرسل للبوت أولاً</small>';
  loadLogs();
});
async function refreshBotStatus() {
  try {
    const r = await api('/api/telegram/bot-status');
    $('#tg-bot-status').innerHTML = r.running
      ? '<span class="badge green">🟢 البوت يعمل (Long Polling سريع ⚡)</span>'
      : '<span class="badge orange">⚪ البوت متوقف</span>';
  } catch (e) {}
}
$('#tg-bot-start').addEventListener('click', async () => {
  await saveSettings();
  const r = await api('/api/telegram/bot', 'POST', { action: 'start' });
  toast(r.ok ? '🤖 البوت يعمل! فعّل وصولك برمز الأمان' : `❌ ${r.error}`);
  refreshBotStatus(); loadLogs();
});
$('#tg-bot-stop').addEventListener('click', async () => {
  await api('/api/telegram/bot', 'POST', { action: 'stop' });
  toast('⏹ تم إيقاف البوت');
  refreshBotStatus(); loadLogs();
});

// ─── Kimi ───
$('#kimi-test').addEventListener('click', async () => {
  await saveSettings();
  const st = $('#kimi-status'); showStatus(st, true, 'جارٍ الاختبار...');
  const r = await api('/api/chat', 'POST', { message: 'اختبار اتصال — رد بجملة واحدة قصيرة' });
  showStatus(st, !r.error, r.error ? `خطأ: ${r.error}` : 'متصل — ' + r.reply.slice(0, 70));
  setBadge('#kimi-badge', !r.error);
  toast(r.error ? `❌ ${r.error}` : '🌙 Kimi API يعمل بنجاح');
  loadLogs();
});

// ─── تشغيل أولي ───
loadStats(); loadTasks(); loadUsers(); loadLogs(); loadSettings(); refreshBotStatus(); loadActivity();
setInterval(() => { loadLogs(); loadActivity(); }, 10000);
