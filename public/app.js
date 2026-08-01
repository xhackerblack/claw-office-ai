// Claw Office AI - منطق الواجهة
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ─── التنقل بين الشاشات ───
function go(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $('#' + id).classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.go === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('.nav-btn, .qa-btn').forEach(b => b.addEventListener('click', () => b.dataset.go && go(b.dataset.go)));

// ─── لوحة التحكم ───
async function loadStats() {
  const s = await api('/api/stats');
  $('#learning-pct').textContent = s.learning + '%';
  $('#msg-today').textContent = s.messagesToday.toLocaleString('ar');
  $('#active-users').textContent = s.activeUsers.toLocaleString('ar');
}
$('#live-learning').addEventListener('change', e =>
  toast(e.target.checked ? '⚡ التعلم المباشر مفعّل' : '⏸ التعلم المباشر معطّل'));

// ─── الدردشة ───
$('#chat-send').addEventListener('click', sendChat);
$('#chat-text').addEventListener('keydown', e => e.key === 'Enter' && sendChat());
async function sendChat() {
  const inp = $('#chat-text');
  if (!inp.value.trim()) return;
  const box = $('#chat-box');
  box.insertAdjacentHTML('beforeend', `<div class="msg me">${inp.value}</div>`);
  const q = inp.value; inp.value = '';
  box.scrollTop = box.scrollHeight;
  try {
    const r = await api('/api/ai/chat', 'POST', { message: q });
    if (r.ok) {
      box.insertAdjacentHTML('beforeend', `<div class="msg ai">🌙 ${r.reply}</div>`);
    } else {
      box.insertAdjacentHTML('beforeend', `<div class="msg ai">⚠️ ${r.error} — (أدخل مفتاح Kimi API في الإعدادات لتفعيل الردود الذكية)</div>`);
      loadLogs();
    }
  } catch (e) {
    box.insertAdjacentHTML('beforeend', `<div class="msg ai">⚠️ خطأ في الاتصال بالخادم</div>`);
  }
  box.scrollTop = box.scrollHeight;
}
$('#upload-doc').addEventListener('click', () => toast('📷 تم فتح الماسح الضوئي... جارٍ المعالجة عبر OCR'));

// ─── المهام ───
const STATUS_AR = { PROCESSING: 'قيد المعالجة', MISSING_INFO: 'معلومات ناقصة', READY: 'جاهز' };
async function loadTasks() {
  const tasks = await api('/api/tasks');
  $('#tasks-list').innerHTML = tasks.map(t => `
    <div class="task-card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b>${t.title}</b><span class="status ${t.status}">${STATUS_AR[t.status] || t.status}</span>
      </div>
      <small style="color:var(--muted)">${t.client} • 📅 ${t.due}</small>
    </div>`).join('');
}

// ─── السجلات ───
let allLogs = [];
async function loadLogs(filter = 'all') {
  allLogs = await api('/api/logs');
  const list = filter === 'all' ? allLogs : allLogs.filter(l => l.level === filter);
  $('#logs-list').innerHTML = list.map(l =>
    `<div class="log-entry ${l.level}">[${l.level}] ${l.text} <small>• ${new Date(l.time).toLocaleTimeString('ar')}</small></div>`
  ).join('') || '<div class="log-entry INFO">لا توجد سجلات</div>';
  $('#status-logs').innerHTML = allLogs.slice(0, 6).map(l =>
    `<div class="log-entry ${l.level}">[${l.level}] ${l.text}</div>`).join('');
}
$$('#log-filters .tab').forEach(t => t.addEventListener('click', () => {
  $$('#log-filters .tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active'); loadLogs(t.dataset.f);
}));

// ─── المستخدمون ───
async function loadUsers() {
  const users = await api('/api/users');
  const q = ($('#user-search').value || '').toLowerCase();
  $('#users-list').innerHTML = users
    .filter(u => !q || u.username.toLowerCase().includes(q))
    .map(u => `
    <div class="user-card ${u.blocked ? 'blocked' : ''}">
      <div class="avatar">${u.username[0].toUpperCase()}</div>
      <div class="user-info">
        <b>${u.handle}</b> <span class="badge ${u.blocked ? 'red' : 'green'}">${u.blocked ? 'محظور' : 'مصرّح'}</span>
        <small>ID: ${u.id} • آخر نشاط: ${u.last}</small>
      </div>
      <button class="btn small ${u.blocked ? 'neon' : ''}" onclick="toggleBlock(${u.id})">${u.blocked ? 'إلغاء الحظر' : 'حظر'}</button>
    </div>`).join('');
}
window.toggleBlock = async id => {
  const u = await api('/api/users/toggle-block', 'POST', { id });
  toast(u.blocked ? `🚫 تم حظر ${u.handle}` : `✅ تم إلغاء حظر ${u.handle}`);
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
    const hl = s => (s || '').replace(new RegExp(q, 'gi'), m => `<mark>${m}</mark>`);
    $('#search-results').innerHTML = results.map(r => `
      <div class="result-card">
        <b>${hl(r.name)}</b> <span class="badge green">${r.type}</span>
        <small style="color:var(--muted);display:block">${hl(r.detail)} • ${r.time || ''}</small>
      </div>`).join('') || '<div class="card center" style="color:var(--muted)">لا توجد نتائج</div>';
  }, 350);
});

// ─── الرسم البياني ───
(function drawChart() {
  const data = [35, 55, 42, 70, 62, 88, 95];
  $('#bar-chart').innerHTML = data.map(v => `<div class="col" style="height:${v}%" title="${v}"></div>`).join('');
})();

// ─── التدريب ───
$('#conf-range').addEventListener('input', e => $('#conf-val').textContent = e.target.value + '%');

// ─── الإعدادات + تلغرام + Kimi ───
async function saveSettings() {
  await api('/api/settings', 'POST', {
    cloudflareAccountId: $('#cf-account').value,
    githubRepo: $('#gh-repo').value, githubBranch: $('#gh-branch').value,
    telegramBotToken: $('#tg-token').value,
    telegramWebhook: $('#tg-webhook').checked,
    kimiApiKey: $('#kimi-key').value,
    kimiModel: $('#kimi-model').value,
  });
}
async function loadSettings() {
  const s = await api('/api/settings');
  if (s.cloudflareAccountId) $('#cf-account').value = s.cloudflareAccountId;
  if (s.githubRepo) $('#gh-repo').value = s.githubRepo;
  if (s.githubBranch) $('#gh-branch').value = s.githubBranch;
  if (s.telegramBotToken) $('#tg-token').value = s.telegramBotToken;
  if (s.telegramWebhook) $('#tg-webhook').checked = true;
  if (s.kimiApiKey) $('#kimi-key').value = s.kimiApiKey;
  if (s.kimiModel) $('#kimi-model').value = s.kimiModel;
}

function showStatus(el, ok, msg) {
  el.innerHTML = `<span class="badge ${ok ? 'green' : 'red'}">${ok ? '✅' : '❌'} ${msg}</span>`;
}

$('#cf-deploy').addEventListener('click', async () => { await saveSettings(); toast('☁ جارٍ النشر على Cloudflare...'); loadLogs(); });
$('#gh-sync').addEventListener('click', async () => { await saveSettings(); toast('⌥ تمت المزامنة مع GitHub'); loadLogs(); });

// تلغرام
$('#tg-test').addEventListener('click', async () => {
  await saveSettings();
  const st = $('#tg-status'); showStatus(st, true, 'جارٍ الاختبار...');
  const r = await api('/api/telegram/test', 'POST', { token: $('#tg-token').value });
  showStatus(st, r.ok, r.ok ? `متصل بالبوت @${r.bot.username}` : `خطأ: ${r.error}`);
  toast(r.ok ? `✈️ متصل بـ @${r.bot.username}` : `❌ ${r.error}`);
  loadLogs();
});
$('#tg-send').addEventListener('click', async () => {
  const r = await api('/api/telegram/send', 'POST', {
    token: $('#tg-token').value, chatId: $('#tg-chatid').value, text: $('#tg-msg').value,
  });
  toast(r.ok ? '📨 تم إرسال الرسالة' : `❌ ${r.error}`);
  if (r.ok) $('#tg-msg').value = '';
  loadLogs();
});
$('#tg-updates').addEventListener('click', async () => {
  await saveSettings();
  const r = await api('/api/telegram/updates');
  if (!r.ok) { toast(`❌ ${r.error}`); loadLogs(); return; }
  $('#tg-messages').innerHTML = r.messages.map(m => `
    <div class="list-item"><span class="dot cyan"></span>
      <span><b>@${m.from}</b> (${m.chatId}): ${m.text}<br><small>${m.date}</small></span>
    </div>`).join('') || '<small style="color:var(--muted)">لا توجد رسائل — أرسل رسالة للبوت أولاً</small>';
  loadLogs();
});

// Kimi
$('#kimi-test').addEventListener('click', async () => {
  await saveSettings();
  const st = $('#kimi-status'); showStatus(st, true, 'جارٍ الاختبار...');
  const r = await api('/api/ai/chat', 'POST', { apiKey: $('#kimi-key').value, model: $('#kimi-model').value, message: 'اختبار اتصال — رد بجملة واحدة قصيرة' });
  showStatus(st, r.ok, r.ok ? 'متصل — الرد: ' + r.reply.slice(0, 80) : `خطأ: ${r.error}`);
  toast(r.ok ? '🌙 Kimi API يعمل' : `❌ ${r.error}`);
  loadLogs();
});

// ─── تشغيل أولي ───
loadStats(); loadTasks(); loadUsers(); loadLogs(); loadSettings();
setInterval(loadLogs, 10000); // تحديث السجلات كل 10 ثوانٍ
