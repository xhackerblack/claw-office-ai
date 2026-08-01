// Claw Office AI — منطق الواجهة
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
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
  const target = $('#' + id);
  if (!target) return;
  target.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.go === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));

// ─── لوحة التحكم ───
async function loadStats() {
  try {
    const s = await api('/api/stats');
    $('#learning-pct').textContent = s.learning + '%';
    $('#msg-today').textContent = s.messagesToday.toLocaleString('ar-MA');
    $('#active-users').textContent = s.activeUsers.toLocaleString('ar-MA');
  } catch (e) {}
}
$('#live-learning').addEventListener('change', e =>
  toast(e.target.checked ? '⚡ التعلم المباشر مفعّل' : '⏸ التعلم المباشر معطّل'));

// ─── الدردشة (Kimi) ───
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
      box.insertAdjacentHTML('beforeend', `<div class="msg ai">⚠️ ${r.error} — (أدخل مفتاح Kimi API في الإعدادات)</div>`);
      loadLogs();
    }
  } catch (e) {
    box.insertAdjacentHTML('beforeend', `<div class="msg ai">⚠️ خطأ في الاتصال بالخادم</div>`);
  }
  box.scrollTop = box.scrollHeight;
}
$('#upload-doc').addEventListener('click', () => toast('📷 جارٍ فتح الماسح الضوئي... المعالجة عبر OCR'));

// ─── المهام ───
const STATUS_AR = { PROCESSING: 'قيد المعالجة', MISSING_INFO: 'معلومات ناقصة', READY: 'جاهز' };
const DESC_AR = { PROCESSING: 'الذكاء الاصطناعي يحلل المستندات.', MISSING_INFO: 'بانتظار توقيع العميل.', READY: 'جاهز للاعتماد النهائي.' };
async function loadTasks() {
  try {
    const tasks = await api('/api/tasks');
    $('#tasks-list').innerHTML = tasks.map(t => `
      <div class="task-card ${t.status}">
        <div class="task-head">
          <div><b>${t.title}</b><br><small style="color:var(--muted)">📅 ${t.due}</small></div>
          <span class="status ${t.status}">${STATUS_AR[t.status] || t.status}</span>
        </div>
        <div class="task-desc">${DESC_AR[t.status] || ''}</div>
      </div>`).join('');
  } catch (e) {}
}
$('#suggest-tg')?.addEventListener('click', () => { go('screen-settings'); toast('✈️ أدخل رمز البوت ومعرف الدردشة ثم أرسل'); });

// ─── السجلات ───
async function loadLogs(filter = 'all') {
  try {
    const allLogs = await api('/api/logs');
    const list = filter === 'all' ? allLogs : allLogs.filter(l => l.level === filter);
    const html = list.map(l =>
      `<div class="log-entry ${l.level}">[${l.level}] ${l.text} <small>• ${new Date(l.time).toLocaleTimeString('ar-MA')}</small></div>`
    ).join('') || '<div class="log-entry INFO">لا توجد سجلات</div>';
    $('#logs-list').innerHTML = html;
    $('#status-logs').innerHTML = allLogs.slice(0, 5).map(l =>
      `<div class="log-entry ${l.level}">[${l.level}] ${l.text}</div>`).join('');
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
    <div class="avatar">${u.username[0].toUpperCase()}</div>
    <div class="user-info">
      <b>${u.handle}</b> <span class="badge ${u.blocked ? 'red' : 'green'}">${u.blocked ? 'محظور' : 'مصرّح'}</span>
      <small>المعرف: ${u.id} • آخر نشاط: ${u.last}</small>
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
      .filter(u => !q || u.username.toLowerCase().includes(q));
    $('#users-list').innerHTML = filtered.map(userCardHTML).join('') ||
      '<div class="card center" style="color:var(--muted)">لا يوجد مستخدمون</div>';
    $('#users-mini').innerHTML = users.slice(0, 3).map(userCardHTML).join('');
  } catch (e) {}
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
        <b>${hl(r.name)}</b> <span class="badge cyan">${r.type}</span>
        <small>${hl(r.detail)} • ${r.time || ''}</small>
      </div>`).join('') || '<div class="card center" style="color:var(--muted)">لا توجد نتائج</div>';
  }, 350);
});

// ─── الرسم البياني الشريطي ───
(function drawChart() {
  const data = [['W1', 55], ['W2', 62], ['W3', 80], ['W4', 95]];
  $('#bar-chart').innerHTML = data.map(([w, v]) =>
    `<div class="col-wrap"><div class="col" style="height:${v}%"></div><small>${w}</small></div>`).join('');
})();

// ─── التدريب والإشعارات ───
$('#conf-range').addEventListener('input', e => $('#conf-val').textContent = e.target.value + '%');
$('#alert-range')?.addEventListener('input', e => $('#alert-val').textContent = e.target.value + ' ساعة');
$$('#notif-freq button').forEach(b => b.addEventListener('click', () => {
  $$('#notif-freq button').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); toast('⏱ تم تغيير التردد إلى: ' + b.textContent);
}));

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
  try {
    const s = await api('/api/settings');
    if (s.cloudflareAccountId) $('#cf-account').value = s.cloudflareAccountId;
    if (s.githubRepo) $('#gh-repo').value = s.githubRepo;
    if (s.githubBranch) $('#gh-branch').value = s.githubBranch;
    if (s.telegramBotToken) { $('#tg-token').value = s.telegramBotToken; setBadge('#tg-badge', true); }
    if (s.telegramWebhook) $('#tg-webhook').checked = true;
    if (s.kimiApiKey) { $('#kimi-key').value = s.kimiApiKey; setBadge('#kimi-badge', true); }
    if (s.kimiModel) $('#kimi-model').value = s.kimiModel;
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

$('#cf-deploy').addEventListener('click', async () => { await saveSettings(); toast('☁ جارٍ النشر على Cloudflare...'); loadLogs(); });
$('#gh-sync').addEventListener('click', async () => { await saveSettings(); toast('⌥ تمت المزامنة مع GitHub'); loadLogs(); });

// تلغرام
$('#tg-test').addEventListener('click', async () => {
  await saveSettings();
  const st = $('#tg-status'); showStatus(st, true, 'جارٍ الاختبار...');
  const r = await api('/api/telegram/test', 'POST', { token: $('#tg-token').value });
  showStatus(st, r.ok, r.ok ? `متصل بالبوت @${r.bot.username}` : `خطأ: ${r.error}`);
  setBadge('#tg-badge', r.ok);
  toast(r.ok ? `✈️ متصل بـ @${r.bot.username}` : `❌ ${r.error}`);
  loadLogs();
});
$('#tg-send').addEventListener('click', async () => {
  const r = await api('/api/telegram/send', 'POST', {
    token: $('#tg-token').value, chatId: $('#tg-chatid').value, text: $('#tg-msg').value,
  });
  toast(r.ok ? '📨 تم إرسال الرسالة بنجاح' : `❌ ${r.error}`);
  if (r.ok) $('#tg-msg').value = '';
  loadLogs();
});
$('#tg-updates').addEventListener('click', async () => {
  await saveSettings();
  const r = await api('/api/telegram/updates');
  if (!r.ok) { toast(`❌ ${r.error}`); loadLogs(); return; }
  $('#tg-messages').innerHTML = r.messages.map(m => `
    <div class="list-item"><span class="dot cyan"></span>
      <span class="grow"><b>@${m.from}</b> (${m.chatId}): ${m.text}<br><small>${m.date}</small></span>
    </div>`).join('') || '<small style="color:var(--muted)">لا توجد رسائل — أرسل رسالة للبوت أولاً</small>';
  loadLogs();
});

// تشغيل/إيقاف محرك البوت
async function refreshBotStatus() {
  try {
    const r = await api('/api/telegram/bot-status');
    $('#tg-bot-status').innerHTML = r.running
      ? '<span class="badge green">🟢 البوت يعمل — يرد تلقائياً على /start والرسائل</span>'
      : '<span class="badge orange">⚪ البوت متوقف</span>';
  } catch (e) {}
}
$('#tg-bot-start').addEventListener('click', async () => {
  await saveSettings();
  const r = await api('/api/telegram/bot', 'POST', { action: 'start', token: $('#tg-token').value });
  toast(r.ok ? '🤖 البوت يعمل الآن! أرسل /start لبوتك في تلغرام' : `❌ ${r.error}`);
  refreshBotStatus(); loadLogs();
});
$('#tg-bot-stop').addEventListener('click', async () => {
  await api('/api/telegram/bot', 'POST', { action: 'stop' });
  toast('⏹ تم إيقاف البوت');
  refreshBotStatus(); loadLogs();
});

// Kimi
$('#kimi-test').addEventListener('click', async () => {
  await saveSettings();
  const st = $('#kimi-status'); showStatus(st, true, 'جارٍ الاختبار...');
  const r = await api('/api/ai/chat', 'POST', { apiKey: $('#kimi-key').value, model: $('#kimi-model').value, message: 'اختبار اتصال — رد بجملة واحدة قصيرة' });
  showStatus(st, r.ok, r.ok ? 'متصل — ' + r.reply.slice(0, 70) : `خطأ: ${r.error}`);
  setBadge('#kimi-badge', r.ok);
  toast(r.ok ? '🌙 Kimi API يعمل بنجاح' : `❌ ${r.error}`);
  loadLogs();
});

// ─── تشغيل أولي ───
loadStats(); loadTasks(); loadUsers(); loadLogs(); loadSettings(); refreshBotStatus();
setInterval(loadLogs, 10000);
