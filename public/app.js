// Claw Office AI v4.0 — منطق الواجهة
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function timeAgo(iso) {
  if (!iso) return '—';
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'الآن'; if (m < 60) return `منذ ${m}د`;
  const h = Math.floor(m / 60); if (h < 24) return `منذ ${h}س`;
  return `منذ ${Math.floor(h / 24)}ي`;
}
function fmtDur(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h >= 24) return Math.floor(h / 24) + 'يوم';
  if (h > 0) return h + 'س' + m + 'د';
  return m + 'د';
}
async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}
function readFile(f) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(f); });
}

// ─── التنقل ───
function go(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  const target = $('#' + id);
  if (!target) return;
  target.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.go === id));
  if (id === 'screen-clients') loadClientsPage();
  if (id === 'screen-agenda') loadAgenda();
  if (id === 'screen-training') loadTemplates();
  if (id === 'screen-users') loadUsers();
  if (id === 'screen-logs') loadLogs();
  if (id === 'screen-dashboard') loadAgentStatus();
}
$$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));

// ─── حالة الوكيل (بيانات حقيقية دقيقة) ───
async function loadAgentStatus() {
  try {
    const s = await api('/api/agent-status');
    // مؤشر مركّب حقيقي: متوسط ما هو متوفر من (دقة OCR، نسبة إنجاز المهام، جاهزية الخدمات)
    const parts = [];
    if (s.ocrRate !== null) parts.push(s.ocrRate);
    if (s.taskRate !== null) parts.push(s.taskRate);
    parts.push((s.botRunning ? 1 : 0) * 100, (s.kimiConfigured ? 1 : 0) * 100);
    const score = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
    $('#agent-pct').textContent = score + '%';
    $('#agent-ring').style.setProperty('--pct', score + '%');
    const svc = [];
    svc.push(s.botRunning ? 'البوت يعمل 🟢' : 'البوت متوقف ⚪');
    svc.push(s.kimiConfigured ? 'Kimi مضبوط 🟢' : 'Kimi غير مضبوط 🔴');
    if (s.kimiLastError) svc.push('آخر خطأ Kimi: ' + s.kimiLastError.slice(0, 60));
    else if (s.kimiLastOk) svc.push('آخر اتصال ناجح بـ Kimi ' + timeAgo(s.kimiLastOk));
    $('#agent-summary').textContent = svc.join(' • ');
    const hg = (id, val, cls) => { const el = $(id); el.querySelector('b').textContent = val; el.className = 'hg-cell ' + cls; };
    hg('#hg-bot', s.botRunning ? 'يعمل' : 'متوقف', s.botRunning ? 'ok' : 'warn');
    hg('#hg-kimi', s.kimiConfigured ? 'مضبوط' : 'مفقود', s.kimiConfigured ? 'ok' : 'bad');
    hg('#hg-ocr', s.ocrRate !== null ? s.ocrRate + '%' : '—', s.ocrRate === null ? '' : s.ocrRate >= 80 ? 'ok' : 'warn');
    hg('#hg-uptime', fmtDur(s.uptimeSec), 'ok');
    $('#st-clients').textContent = s.clients;
    $('#st-docs').textContent = s.docsProcessed;
    $('#st-rems').textContent = s.remindersPending;
    $('#st-tasks').textContent = s.tasksActive;
    $('#st-msgs').textContent = s.messagesToday;
    $('#st-size').textContent = (s.dataSize / 1024).toFixed(1) + 'KB';
    $('#act-count').textContent = s.lastActivity ? 'آخر نشاط ' + timeAgo(s.lastActivity) : '';
  } catch (e) {}
}

async function loadActivity() {
  try {
    const logs = await api('/api/logs');
    const dot = { error: 'red', success: 'green', warning: 'amber', system: 'navy' };
    $('#recent-activity').innerHTML = logs.slice(0, 5).map(l =>
      `<div class="row"><span class="dot ${dot[l.level] || 'navy'}"></span><span class="grow ellip" style="font-weight:700">${esc(l.text)}</span><small>${timeAgo(l.at)}</small></div>`
    ).join('') || '<p class="muted small" style="font-weight:700;padding:10px 0">لا نشاط بعد</p>';
  } catch (e) {}
}

// ─── العملاء (بطاقات محسّنة للهاتف) ───
let allClients = [];
const AV = ['avatar', 'avatar t2', 'avatar t3'];
function clientCardHTML(c, i) {
  const rows = [
    ['🆔', c.nationalId], ['📞', c.phone], ['✉️', c.email], ['🎂', c.birthDate],
    ['📍', c.address], ['📅', c.expiry]
  ].filter(([, v]) => v);
  return `
  <div class="card client-card">
    <div class="client-top">
      <div class="${AV[i % 3]}" style="width:48px;height:48px">${esc((c.fullName || c.nationalId || '؟')[0].toUpperCase())}</div>
      <div class="grow">
        <b title="${esc(c.fullName || '')}">${esc(c.fullName || 'بدون اسم')}</b>
        <small>${esc(c.docType || 'مستند')} • ${timeAgo(c.updatedAt)}</small>
      </div>
      <span class="badge ${c.verified ? 'green' : 'amber'}">${c.verified ? '✔ موثّق' : 'غير موثّق'}</span>
    </div>
    ${rows.length ? `<div class="client-rows">${rows.map(([k, v]) => `<div class="crow">${k}<span title="${esc(v)}">${esc(v)}</span></div>`).join('')}</div>` : ''}
    ${c.notes ? `<small class="muted" style="font-weight:700">📝 ${esc(c.notes.slice(0, 80))}${c.notes.length > 80 ? '…' : ''}</small>` : ''}
    <div class="client-actions">
      <button class="btn small navy" onclick="editClient('${esc(c.id)}')">✏️ تعديل</button>
      <button class="btn small" onclick="deleteClient('${esc(c.id)}')">🗑 حذف</button>
    </div>
  </div>`;
}
function renderClientsGrid() {
  const q = ($('#client-search').value || '').toLowerCase();
  const list = allClients.filter(c => !q || JSON.stringify(c).toLowerCase().includes(q));
  $('#clients-grid').innerHTML = list.map(clientCardHTML).join('') ||
    '<div class="empty"><div class="big">🧾</div>لا عملاء — امسح مستنداً 📷 أو أضف يدوياً ➕</div>';
}
async function loadClientsPage() {
  try { allClients = await api('/api/clients'); renderClientsGrid(); } catch (e) {}
}
window.editClient = id => {
  const c = allClients.find(x => x.id === id);
  if (!c) return;
  $('#ce-title').textContent = '✏️ تعديل: ' + (c.fullName || c.nationalId || 'عميل');
  $('#ce-id').value = c.id;
  for (const k of ['fullName','nationalId','phone','email','birthDate','address','docType','notes']) $('#ce-' + k).value = c[k] || '';
  $('#client-edit-card').style.display = 'block';
};
window.deleteClient = async id => {
  const c = allClients.find(x => x.id === id);
  if (!confirm('حذف العميل "' + ((c && (c.fullName || c.nationalId)) || '') + '" نهائياً؟')) return;
  const r = await api('/api/clients/' + encodeURIComponent(id), 'DELETE');
  if (r.ok) { toast('🗑 تم حذف العميل'); loadClientsPage(); loadAgentStatus(); }
  else toast('❌ فشل الحذف');
};
$('#client-add-btn').addEventListener('click', () => {
  $('#ce-title').textContent = '➕ عميل جديد';
  $('#ce-id').value = '';
  for (const k of ['fullName','nationalId','phone','email','birthDate','address','docType','notes']) $('#ce-' + k).value = '';
  $('#client-edit-card').style.display = 'block';
});
$('#ce-cancel').addEventListener('click', () => { $('#client-edit-card').style.display = 'none'; });
$('#ce-save').addEventListener('click', async () => {
  const id = $('#ce-id').value;
  const body = {};
  for (const k of ['fullName','nationalId','phone','email','birthDate','address','docType','notes']) body[k] = $('#ce-' + k).value.trim();
  if (!body.fullName && !body.nationalId && !body.phone) { toast('⚠️ أدخل الاسم أو رقم التعريف'); return; }
  const r = id
    ? await api('/api/clients/update', 'POST', { id, ...body })
    : await api('/api/clients', 'POST', body);
  if (r.error) { toast('❌ ' + r.error); return; }
  toast(id ? '✅ تم حفظ التعديلات' : '✅ أُنشئ العميل — 🔔 تذكير مفعّل');
  $('#client-edit-card').style.display = 'none';
  loadClientsPage(); loadAgentStatus(); loadActivity();
});
$('#client-search').addEventListener('input', renderClientsGrid);

// ─── المستندات: رفع صورة → OCR ───
$('#doc-drop').addEventListener('click', () => $('#doc-file').click());
$('#doc-file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  if (!/^image\//.test(f.type)) { toast('⚠️ هنا تُدرج الصور فقط — القوالب من صفحة التدريب'); e.target.value = ''; return; }
  toast('⏳ جارٍ تحليل الصورة بالذكاء الاصطناعي...');
  const b64 = await readFile(f);
  try {
    const r = await api('/api/ocr', 'POST', { image: b64, mime: f.type });
    if (r.error) { toast('❌ ' + r.error); renderExtracted(null); return; }
    renderExtracted(r.client);
    toast((r.isNew ? '✅ ملف عميل جديد أُنشئ' : '🔄 تم تحديث العميل') + ' — 🔔 بعد ' + r.reminderHours + 'س');
    loadActivity(); loadAgentStatus();
  } catch (err) { toast('❌ خطأ في الاتصال'); }
  e.target.value = '';
});
function renderExtracted(c) {
  const box = $('#extracted-data');
  if (!c) { box.innerHTML = '<p class="muted small" style="font-weight:700">تعذر الاستخراج — جرّب صورة أوضح</p>'; return; }
  const rows = [
    ['الاسم الكامل', c.fullName], ['رقم التعريف', c.nationalId], ['تاريخ الميلاد', c.birthDate],
    ['مكان الازدياد', c.birthPlace], ['العنوان', c.address], ['الهاتف', c.phone],
    ['البريد', c.email], ['صالحة إلى', c.expiry], ['نوع المستند', c.docType], ['ملاحظات', c.notes]
  ].filter(([, v]) => v);
  box.innerHTML = rows.map(([k, v]) =>
    `<div class="row"><span class="muted small" style="width:92px;flex-shrink:0;font-weight:800">${k}</span><span class="grow ellip" style="font-weight:800;text-align:left" dir="auto">${esc(v)}</span></div>`
  ).join('');
}

// ─── الدردشة ───
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

// ─── الملفات المعلقة والمواعيد (تذكيرات + مهام) ───
let agendaTab = 'reminders';
$$('#agenda-tabs .tab').forEach(t => t.addEventListener('click', () => {
  $$('#agenda-tabs .tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active'); agendaTab = t.dataset.f; loadAgenda();
}));
async function loadAgenda() {
  const box = $('#agenda-list');
  try {
    if (agendaTab === 'reminders') {
      const rems = await api('/api/reminders');
      const pend = rems.filter(r => !r.sent);
      box.innerHTML = pend.map(r => {
        const mins = Math.max(0, Math.round((r.at - Date.now()) / 60000));
        const when = mins >= 60 ? Math.floor(mins / 60) + 'س' + (mins % 60) + 'د' : mins + 'د';
        return `<div class="item-card">
          <div class="ic" style="background:rgba(255,176,32,.15)">⏰</div>
          <div class="grow"><b title="${esc(r.clientName)}">🧾 ${esc(r.clientName)}</b><small>تذكير بملف العميل — كل ${r.hours}س</small></div>
          <span class="badge amber">بعد ${when}</span>
        </div>`;
      }).join('') || '<div class="empty"><div class="big">⏰</div>لا تذكيرات قادمة — أنشئ عميلاً لتوليد تذكير تلقائي</div>';
    } else {
      const tasks = await api('/api/tasks');
      const act = tasks.filter(t => !t.done);
      box.innerHTML = act.map(t => `<div class="item-card">
          <div class="ic" style="background:rgba(14,173,154,.12)">✅</div>
          <div class="grow"><b title="${esc(t.title)}">${esc(t.title)}</b><small>${esc(t.due || 'بدون موعد')} • ${esc(t.priority || '')}</small></div>
          <button class="btn small teal" onclick="doneTask('${esc(t.id)}')">إنجاز</button>
        </div>`).join('') || '<div class="empty"><div class="big">✅</div>لا مهام معلقة — أضفها عبر البوت: /addtask</div>';
    }
  } catch (e) {}
}
window.doneTask = async id => {
  await api('/api/tasks/toggle', 'POST', { id });
  toast('✅ أُنجزت المهمة'); loadAgenda(); loadAgentStatus();
};

// ─── التدريب والقوالب ───
$('#tpl-drop').addEventListener('click', () => $('#tpl-file').click());
$('#tpl-file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  toast('⏳ جارٍ قراءة الملف والتعلم منه...');
  const b64 = await readFile(f);
  try {
    const r = await api('/api/templates/upload', 'POST', { fileName: f.name, mime: f.type, content: b64 });
    if (r.error) { toast('❌ ' + r.error); return; }
    toast('🧠 تعلّم قالباً: ' + r.template.name + (r.template.fields.length ? ' (' + r.template.fields.length + ' حقل)' : ''));
    loadTemplates(); loadActivity();
  } catch (err) { toast('❌ خطأ في الاتصال'); }
  e.target.value = '';
});
$('#tpl-save-text').addEventListener('click', async () => {
  const name = $('#tpl-name').value.trim(), text = $('#tpl-text').value.trim();
  if (!text) { toast('⚠️ الصق نص القالب أولاً'); return; }
  const r = await api('/api/templates/upload', 'POST', { name, text });
  if (r.error) { toast('❌ ' + r.error); return; }
  toast('🧠 تعلّم قالباً: ' + r.template.name);
  $('#tpl-name').value = ''; $('#tpl-text').value = '';
  loadTemplates(); loadActivity();
});
let allTemplates = [];
async function loadTemplates() {
  try {
    allTemplates = await api('/api/templates');
    $('#tpl-count').textContent = allTemplates.length + ' قالب';
    $('#templates-list').innerHTML = allTemplates.map(t => `
      <div class="tpl-card">
        <div class="top">
          <div class="avatar t2" style="width:42px;height:42px;font-size:18px">📄</div>
          <div class="grow" style="flex:1;min-width:0">
            <b class="ellip" style="display:block;font-size:13.5px;font-weight:900">${esc(t.name)}</b>
            <small class="muted" style="font-weight:700">${esc(t.source)} • ${(t.size / 1024).toFixed(1)}KB • ${timeAgo(t.createdAt)}</small>
          </div>
        </div>
        ${t.fields.length ? `<div class="tpl-fields">${t.fields.map(f => `<span class="tpl-chip">${esc(f)}</span>`).join('')}</div>` : ''}
        <div class="tpl-actions">
          <button class="btn small coral" onclick="openGenerate('${esc(t.id)}')">🖨 إنشاء وثيقة</button>
          <button class="btn small" onclick="deleteTemplate('${esc(t.id)}')">🗑</button>
        </div>
      </div>`).join('') || '<div class="empty"><div class="big">🧠</div>لا قوالب بعد — ارفع نموذجاً أو الصق نصاً ليتعلم منه</div>';
  } catch (e) {}
}
window.deleteTemplate = async id => {
  if (!confirm('حذف هذا القالب نهائياً؟')) return;
  await api('/api/templates/' + encodeURIComponent(id), 'DELETE');
  toast('🗑 حُذف القالب'); loadTemplates();
};

// ─── توليد وثيقة من قالب ───
const FIELD_LABELS = { fullName: 'الاسم الكامل', nationalId: 'رقم التعريف', phone: 'الهاتف', email: 'البريد', address: 'العنوان', birthDate: 'تاريخ الميلاد', birthPlace: 'مكان الازدياد', docType: 'نوع المستند', date: 'التاريخ', today: 'التاريخ' };
let genTemplateId = null;
window.openGenerate = async id => {
  genTemplateId = id;
  const t = allTemplates.find(x => x.id === id);
  if (!t) return;
  $('#gen-title').textContent = '🖨 إنشاء: ' + t.name;
  const sel = $('#gen-client');
  sel.innerHTML = '<option value="">— بدون عميل —</option>' +
    allClients.map(c => `<option value="${esc(c.id)}">${esc(c.fullName || c.nationalId || 'عميل')}</option>`).join('');
  $('#gen-fields').innerHTML = t.fields.map(f =>
    `<label class="flabel">${esc(FIELD_LABELS[f] || f)} <span class="muted">(${esc(f)})</span></label>
     <input class="field gen-val" data-f="${esc(f)}" placeholder="${esc(FIELD_LABELS[f] || f)}">`
  ).join('') || '<p class="muted small" style="font-weight:700">هذا القالب بلا حقول — سيُولَّد كما هو.</p>';
  sel.onchange = () => {
    const c = allClients.find(x => x.id === sel.value) || {};
    $$('.gen-val').forEach(inp => { inp.value = c[inp.dataset.f] || ''; });
  };
  $('#gen-overlay').style.display = 'flex';
};
$('#gen-cancel').addEventListener('click', () => { $('#gen-overlay').style.display = 'none'; });
$('#gen-run').addEventListener('click', async () => {
  const values = {};
  $$('.gen-val').forEach(inp => { if (inp.value.trim()) values[inp.dataset.f] = inp.value.trim(); });
  toast('⏳ جارٍ توليد الوثيقة...');
  const r = await api('/api/templates/generate', 'POST', {
    templateId: genTemplateId, clientId: $('#gen-client').value || undefined, values
  });
  if (r.error) { toast('❌ ' + r.error); return; }
  $('#gen-overlay').style.display = 'none';
  const blob = new Blob([r.html], { type: 'text/html;charset=utf-8' });
  window.open(URL.createObjectURL(blob), '_blank');
  toast('🖨 فُتحت الوثيقة — اضغط "طباعة / حفظ كـ PDF"');
  loadActivity();
});

// ─── المستخدمون ───
async function loadUsers() {
  try {
    const users = await api('/api/users');
    const q = ($('#user-search').value || '').toLowerCase();
    const list = users.filter(u => !q || (u.username || '').toLowerCase().includes(q));
    $('#users-list').innerHTML = list.map((u, i) => `
      <div class="item-card">
        <div class="${AV[i % 3]}" style="width:42px;height:42px">${esc((u.username || '?')[0].toUpperCase())}</div>
        <div class="grow">
          <b>${esc(u.username || '')}</b>
          <small>ID: ${esc(u.id)} • ${timeAgo(u.lastSeen)}</small>
        </div>
        <span class="badge ${u.blocked ? 'red' : u.authed ? 'green' : 'amber'}">${u.blocked ? 'محظور' : u.authed ? 'مصرّح' : 'ينتظر'}</span>
        <button class="btn small ${u.blocked ? 'teal' : ''}" onclick="toggleBlock(${u.id})">${u.blocked ? 'إلغاء الحظر' : 'حظر'}</button>
      </div>`).join('') || '<div class="empty"><div class="big">🛡</div>لا مستخدمون بعد — فعّلوا البوت برمز الأمان</div>';
  } catch (e) {}
}
window.toggleBlock = async id => {
  const u = await api('/api/users/toggle-block', 'POST', { id });
  toast(u.blocked ? `🚫 تم حظر ${u.username}` : `✅ أُلغي حظر ${u.username}`);
  loadUsers();
};
$('#user-search').addEventListener('input', loadUsers);

// ─── السجلات ───
let logFilter = 'all';
$$('#log-filters .tab').forEach(t => t.addEventListener('click', () => {
  $$('#log-filters .tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active'); logFilter = t.dataset.f; loadLogs();
}));
async function loadLogs() {
  try {
    const all = await api('/api/logs');
    const list = logFilter === 'all' ? all : all.filter(l => l.level === logFilter);
    $('#logs-list').innerHTML = list.map(l =>
      `<div class="log-entry ${esc(l.level)}">${esc(l.text)} <small>• ${timeAgo(l.at)}</small></div>`
    ).join('') || '<div class="empty"><div class="big">📊</div>لا سجلات</div>';
  } catch (e) {}
}

// ─── البحث العميق ───
let searchTimer;
$('#deep-search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = e.target.value.trim();
    if (!q) { $('#search-results').innerHTML = ''; return; }
    const results = await api('/api/search', 'POST', { q });
    const hl = s => esc(s || '').replace(new RegExp(escRe(q), 'gi'), m => `<b style="color:var(--coral)">${m}</b>`);
    $('#search-results').innerHTML = (results.results || []).map(r => `
      <div class="item-card">
        <div class="ic" style="background:rgba(30,34,71,.08)">🔎</div>
        <div class="grow"><b>${hl(r.name)}</b><small>${hl(r.detail)}</small></div>
        <span class="badge navy">${r.type}</span>
      </div>`).join('') || '<div class="empty"><div class="big">🔍</div>لا نتائج</div>';
  }, 350);
});

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
  b.className = 'badge ' + (connected ? 'green' : 'amber');
  b.textContent = connected ? 'متصل' : 'غير متصل';
}
function showStatus(el, ok, msg) {
  el.innerHTML = `<span class="badge ${ok ? 'green' : 'red'}" style="font-size:11px">${ok ? '✅' : '❌'} ${esc(msg)}</span>`;
}
$('#token-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#access-token').value); toast('📋 نُسخ — أرسله للبوت: /auth ' + $('#access-token').value); }
  catch (e) { $('#access-token').select(); document.execCommand('copy'); toast('📋 تم النسخ'); }
});
$('#token-regen').addEventListener('click', async () => {
  if (!confirm('رمز جديد سيلغي صلاحية كل مستخدمي البوت. متابعة؟')) return;
  const r = await api('/api/token/regen', 'POST', {});
  if (r.ok) { $('#access-token').value = r.token; toast('🔐 رمز جديد: ' + r.token); }
});
$('#rem-range').addEventListener('input', e => $('#rem-val').textContent = e.target.value + ' ساعة');
$('#rem-save').addEventListener('click', async () => {
  await api('/api/settings', 'POST', { reminderHours: parseFloat($('#rem-range').value) });
  toast('💾 حُفظت مدة التذكير: ' + $('#rem-range').value + 'س');
});
$('#tg-test').addEventListener('click', async () => {
  await saveSettings();
  const st = $('#tg-status'); showStatus(st, true, 'جارٍ الاختبار...');
  const r = await api('/api/telegram/test', 'POST', {});
  showStatus(st, r.ok, r.ok ? `متصل @${r.bot.username}` : `خطأ: ${r.error}`);
  setBadge('#tg-badge', r.ok);
});
$('#tg-bot-start').addEventListener('click', async () => {
  await saveSettings();
  const r = await api('/api/telegram/bot', 'POST', { action: 'start' });
  toast(r.ok ? '🤖 البوت يعمل!' : `❌ ${r.error}`);
  refreshBotStatus();
});
$('#tg-bot-stop').addEventListener('click', async () => {
  await api('/api/telegram/bot', 'POST', { action: 'stop' });
  toast('⏹ توقف البوت'); refreshBotStatus();
});
async function refreshBotStatus() {
  try {
    const r = await api('/api/telegram/bot-status');
    $('#tg-bot-status').innerHTML = r.running
      ? '<span class="badge green">🟢 البوت يعمل</span>'
      : '<span class="badge amber">⚪ البوت متوقف</span>';
  } catch (e) {}
}
$('#kimi-test').addEventListener('click', async () => {
  await saveSettings();
  const st = $('#kimi-status'); showStatus(st, true, 'جارٍ الاختبار...');
  const r = await api('/api/kimi/test', 'POST', {});
  showStatus(st, !!r.ok, r.ok ? 'متصل — تأكيد أُرسل إلى تلغرام 🌙' : `خطأ: ${r.error || 'فشل'}`);
  setBadge('#kimi-badge', !!r.ok);
  toast(r.ok ? '🌙 Kimi متصل — تحقق من البوت' : `❌ ${r.error || 'فشل'}`);
});

// ─── حالة الاتصال الحية ───
async function pingHealth() {
  const el = $('#live-status');
  try {
    const r = await api('/api/health');
    el.className = 'live-dot' + (r.ok ? '' : ' off');
    el.innerHTML = '<i></i> ' + (r.ok ? 'متصل' : 'مشكلة');
  } catch (e) { el.className = 'live-dot off'; el.innerHTML = '<i></i> منقطع'; }
}

// ─── تشغيل أولي ───
loadAgentStatus(); loadActivity(); loadSettings(); refreshBotStatus(); pingHealth();
setInterval(() => { loadAgentStatus(); loadActivity(); pingHealth(); }, 12000);
