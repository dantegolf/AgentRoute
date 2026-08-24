let config = null;
let tasks = [];
let protocols = [];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function render() {
  const providers = Object.entries(config?.providers || {});
  const workers = Object.entries(config?.workers || {});
  $('#providerCount').textContent = providers.length;
  $('#workerCount').textContent = workers.length;
  $('#taskCount').textContent = tasks.length;
  $('#reviewCount').textContent = tasks.filter((task) => task.status === 'review').length;

  const providerOptions = providers.map(([id, p]) => `<option value="${esc(id)}">${esc(p.label || id)}</option>`).join('');
  $('#workerProvider').innerHTML = providerOptions;
  $('#taskWorker').innerHTML = workers.length ? workers.map(([id, w]) => `<option value="${esc(id)}">${esc(id)} · ${esc(w.model)}</option>`).join('') : '<option value="">No workers configured</option>';
  $('#providerProtocol').innerHTML = protocols.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');

  $('#providerList').innerHTML = providers.map(([id, p]) => {
    const auth = p.auth?.type === 'env' ? `${p.auth.name}${p.auth.available ? ' ✓' : ' (missing)'}` : p.auth?.type || 'none';
    return `<div class="item"><div class="item-top"><strong>${esc(p.label || id)}</strong><small>${esc(id)}</small></div><div class="tags"><span class="tag">${esc(p.protocol)}</span><span class="tag">${esc(auth)}</span></div><div class="muted" style="margin-top:8px;font-size:11px">${esc(p.baseUrl)}</div></div>`;
  }).join('') || '<p class="muted">No providers.</p>';

  $('#workerList').innerHTML = workers.map(([id, w]) => `<div class="item"><div class="item-top"><strong>${esc(id)}</strong><small>${esc(w.provider)}</small></div><div class="tags"><span class="tag">${esc(w.model)}</span><span class="tag">${Number(w.maxTurns || 24)} turns</span><span class="tag">shell ${w.allowShell === false ? 'off' : 'on'}</span></div></div>`).join('') || '<p class="muted">No worker profiles yet.</p>';

  $('#taskList').innerHTML = tasks.map((task) => `<div class="item"><div class="item-top"><div><strong>${esc(task.worker)}</strong><div class="muted" style="font-size:11px;margin-top:4px">${esc(task.repo)}</div></div><span class="tag ${esc(task.status)}">${esc(task.status)}</span></div><div class="tags"><span class="tag">${esc(task.workspaceMode || 'current')}</span><span class="tag">${esc(task.id)}</span><span class="tag">${esc(new Date(task.createdAt).toLocaleString())}</span></div><details class="task-detail"><summary>Task & evidence</summary>\n${esc(task.task)}${task.baseline?.status ? `\n\nPRE-EXISTING STATUS\n${esc(task.baseline.status)}` : ''}${task.evidence?.diffStat ? `\n\nDIFF STAT\n${esc(task.evidence.diffStat)}` : ''}${task.error ? `\n\nERROR\n${esc(task.error)}` : ''}</details></div>`).join('') || '<p class="muted">No tasks yet.</p>';
}

async function refresh() {
  try {
    const [health, cfg, list, proto] = await Promise.all([api('/api/health'), api('/api/config'), api('/api/tasks'), api('/api/protocols')]);
    config = cfg; tasks = list; protocols = proto;
    $('#healthDot').classList.add('ok'); $('#healthText').textContent = `${health.running} running`;
    render();
    const status = await api('/api/codex/status');
    $('#skillStatus').textContent = status.skillInstalled ? `Installed: ${status.skillPath}` : 'Not installed globally.';
    $('#autoStatus').textContent = status.autoDelegation ? `Enabled in ${status.agentsPath}` : 'Disabled. Explicit skill delegation still works.';
  } catch (error) {
    $('#healthText').textContent = error.message;
  }
}

$$('nav button').forEach((button) => button.addEventListener('click', () => {
  $$('nav button').forEach((b) => b.classList.toggle('active', b === button));
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === button.dataset.view));
  $('#viewTitle').textContent = button.textContent;
}));

async function discoverModels() {
  const providerId = $('#workerProvider').value;
  const status = $('#modelDiscoveryStatus');
  if (!providerId) { status.textContent = 'Choose a provider first.'; return; }
  status.textContent = 'Loading…';
  try {
    const models = await api(`/api/providers/${encodeURIComponent(providerId)}/models`);
    $('#workerModelOptions').innerHTML = models.slice(0, 500).map((model) => `<option value="${esc(model.id)}">${esc(model.label || model.id)}</option>`).join('');
    status.textContent = models.length ? `${models.length} model(s) discovered.` : 'Provider returned no model list.';
  } catch (error) {
    status.textContent = error.message;
  }
}

$('#refreshBtn').addEventListener('click', refresh);

$('#taskForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const out = $('#dispatchResult'); out.classList.remove('hidden'); out.textContent = 'Dispatching…';
  try { out.textContent = JSON.stringify(await api('/api/tasks', { method: 'POST', body: JSON.stringify(data) }), null, 2); await refresh(); }
  catch (error) { out.textContent = error.message; }
});

$('#providerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  config.providers[data.id] = { label: data.label, protocol: data.protocol, baseUrl: data.baseUrl, auth: data.apiKeyEnv ? { type: 'env', name: data.apiKeyEnv } : { type: 'none' } };
  await api('/api/config', { method: 'PUT', body: JSON.stringify(config) }); event.currentTarget.reset(); await refresh();
});

$('#workerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const fd = new FormData(event.currentTarget); const data = Object.fromEntries(fd);
  config.workers[data.id] = { provider: data.provider, model: data.model, maxTurns: Number(data.maxTurns || 24), allowShell: fd.has('allowShell') };
  if (!config.defaults.worker) config.defaults.worker = data.id;
  await api('/api/config', { method: 'PUT', body: JSON.stringify(config) }); event.currentTarget.reset(); await refresh();
});

$('#discoverModelsBtn').addEventListener('click', discoverModels);
$('#workerProvider').addEventListener('change', () => { $('#workerModelOptions').innerHTML = ''; $('#modelDiscoveryStatus').textContent = ''; });

$('#installSkillBtn').addEventListener('click', async () => { await api('/api/codex/install-skill', { method: 'POST', body: '{}' }); await refresh(); });
$('#autoOnBtn').addEventListener('click', async () => { await api('/api/codex/auto', { method: 'POST', body: JSON.stringify({ enabled: true }) }); await refresh(); });
$('#autoOffBtn').addEventListener('click', async () => { await api('/api/codex/auto', { method: 'POST', body: JSON.stringify({ enabled: false }) }); await refresh(); });

refresh();
setInterval(() => { if ($('#tasks').classList.contains('active') || $('#dashboard').classList.contains('active')) refresh(); }, 5000);
