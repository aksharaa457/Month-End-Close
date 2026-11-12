/**
 * Continuous Close Hub - Continuous Close Solution
 * Continuous Close Platform
 */

// Application State
const state = {
  currentView: 'entities',
  selectedEntity: 'global-close',
  entities: [],
  sources: [],
  overviewData: null,
  checklistData: null,
  accrualsData: null,
  recognitionData: null,
  fluxData: null,
  journalsData: null,
  activeTask: null,
  activeContract: null,
  activeVariance: null
};

// DOM References
const elements = {
  views: {
    entities: document.getElementById('view-entities'),
    sources: document.getElementById('view-sources'),
    overview: document.getElementById('view-overview'),
    checklist: document.getElementById('view-checklist'),
    accruals: document.getElementById('view-accruals'),
    recognition: document.getElementById('view-recognition'),
    flux: document.getElementById('view-flux'),
    journals: document.getElementById('view-journals')
  },
  breadcrumbs: document.getElementById('top-breadcrumbs'),
  treeNavLinks: document.querySelectorAll('.tree-item'),
  toastContainer: document.getElementById('toast-container')
};

// Utilities
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>✦</span> <span>${message}</span>`;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function formatCurrency(num) {
  if (num === null || num === undefined) return '$0.00';
  return '$' + Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Router
function navigateTo(viewName, entityId = null) {
  if (entityId) state.selectedEntity = entityId;
  state.currentView = viewName;

  // Toggle view containers
  Object.keys(elements.views).forEach(key => {
    if (elements.views[key]) {
      elements.views[key].style.display = (key === viewName) ? 'block' : 'none';
    }
  });

  // Update Breadcrumbs
  updateBreadcrumbs(viewName);

  // Update Sidebar Tree Active Link
  elements.treeNavLinks.forEach(link => {
    link.classList.toggle('active', link.dataset.view === viewName);
  });

  // Load View Data
  switch (viewName) {
    case 'entities':
      loadEntities();
      break;
    case 'sources':
      loadSources();
      break;
    case 'overview':
      loadOverview();
      break;
    case 'checklist':
      loadChecklist();
      break;
    case 'accruals':
      loadAccruals();
      break;
    case 'recognition':
      loadRecognition();
      break;
    case 'flux':
      loadFlux();
      break;
    case 'journals':
      loadJournals();
      break;
  }
}

function updateBreadcrumbs(viewName) {
  let breadcrumbHtml = '<span>Record to Report</span> <span class="sep">&gt;</span> ';
  if (viewName === 'entities') {
    breadcrumbHtml += '<span class="current">Close Management (Multi-Entity Hub)</span>';
  } else if (viewName === 'sources') {
    breadcrumbHtml += '<span>Close Management</span> <span class="sep">&gt;</span> <span class="current">Enterprise Brain / Setup</span>';
  } else if (viewName === 'journals') {
    breadcrumbHtml = '<span>Month-end close</span> <span class="sep">&gt;</span> <span>Global Close</span> <span class="sep">&gt;</span> <span>Flux & variance</span> <span class="sep">&gt;</span> <span class="current">Drafted Journal Entries</span>';
  } else {
    const titles = {
      overview: 'Closure overview',
      checklist: 'Checklist',
      accruals: 'Accrual & prepaid',
      recognition: 'Recognition and compliance',
      flux: 'Flux & variance'
    };
    breadcrumbHtml = `<span>Month-end close</span> <span class="sep">&gt;</span> <span>Global Close</span> <span class="sep">&gt;</span> <span class="current">${titles[viewName] || viewName}</span>`;
  }
  elements.breadcrumbs.innerHTML = breadcrumbHtml;
}

// ================= 1. ENTITIES VIEW =================
async function loadEntities() {
  try {
    const res = await fetch('/api/entities');
    const data = await res.json();
    state.entities = data.entities;
    renderEntitiesGrid();
  } catch (err) {
    console.error('Failed to load entities', err);
  }
}

function renderEntitiesGrid() {
  const container = document.getElementById('entities-grid');
  if (!container) return;

  container.innerHTML = state.entities.map(e => {
    let badgeClass = 'badge-review';
    if (e.status === 'At risk') badgeClass = 'badge-risk';
    else if (e.status === 'On track') badgeClass = 'badge-ontrack';
    else if (e.status === 'SET UP REQUIRED') badgeClass = 'badge-setup';

    // SVG Radial Donut
    const radius = 30;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (e.progress_pct / 100) * circumference;
    const strokeColor = e.status === 'At risk' ? '#C93B2B' : (e.status === 'On track' ? '#15803D' : '#D97706');

    return `
      <div class="entity-card" data-entity-id="${e.id}">
        <div class="entity-card-header">
          <div class="entity-name">${e.name} - ${e.period}</div>
          <span class="status-pill ${badgeClass}">${e.status}</span>
        </div>

        <div class="entity-radial-wrapper">
          <svg width="84" height="84" viewBox="0 0 80 80" class="radial-svg">
            <circle cx="40" cy="40" r="${radius}" stroke="#E5E1D5" stroke-width="7" fill="none" />
            <circle cx="40" cy="40" r="${radius}" stroke="${strokeColor}" stroke-width="7" fill="none"
              stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
              stroke-linecap="round" transform="rotate(-90 40 40)" />
            <text x="40" y="44" text-anchor="middle" font-size="13">${e.progress_pct}%</text>
          </svg>
        </div>

        <div class="entity-metrics-row">
          <div class="entity-metric-item">
            <span class="em-label">TASKS COMPLETE</span>
            <span class="em-val">${e.tasks_completed} / ${e.total_tasks}</span>
          </div>
          <div class="entity-metric-item">
            <span class="em-label">OPEN TASKS</span>
            <span class="em-val">${e.open_tasks}</span>
          </div>
        </div>

        <div class="entity-card-footer">
          ${e.status === 'SET UP REQUIRED' ? 
            `<button class="btn btn-outline-sm btn-setup-entity" data-id="${e.id}">Set up &rarr;</button>` : 
            `<span class="link-dashboard">View dashboard &rarr;</span>`}
        </div>
      </div>
    `;
  }).join('');

  // Attach card click handlers
  container.querySelectorAll('.entity-card').forEach(card => {
    card.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('btn-setup-entity')) {
        navigateTo('sources');
      } else {
        navigateTo('overview', card.dataset.entityId);
      }
    });
  });
}

// ================= 2. ENTERPRISE BRAIN SOURCES =================
async function loadSources() {
  try {
    const res = await fetch('/api/sources');
    const data = await res.json();
    state.sources = data.sources;
    renderSourcesList();
  } catch (err) {
    console.error('Failed to load sources', err);
  }
}

function renderSourcesList() {
  const container = document.getElementById('sources-brain-list');
  if (!container) return;

  const icons = {
    'Communication': '💬',
    'Documents & budget': '📁',
    'Ledger': '📒',
    'Contracts & CRM': '🤝',
    'Billing & usage': '⚡',
    'Banking': '🏦'
  };

  container.innerHTML = state.sources.map(s => `
    <div class="source-item-row">
      <div class="src-item-info">
        <span class="src-icon">${icons[s.category] || '🔹'}</span>
        <div>
          <div class="src-item-name">${s.name} <span style="font-size:11px; color:#8A909D; font-weight:normal;">(${s.category})</span></div>
          <div class="src-item-desc">${s.details}</div>
        </div>
      </div>
      <div>
        <span class="src-tag-brain">✦ Via Brain</span>
      </div>
    </div>
  `).join('');
}

// ================= 3. CLOSURE OVERVIEW =================
async function loadOverview() {
  try {
    const res = await fetch('/api/overview');
    const data = await res.json();
    state.overviewData = data;

    // Render Burndown SVG
    renderBurndownSVG(data.burndown);

    // Render Workload SVG
    renderWorkloadSVG(data.subprocesses);

    // Render Modules
    renderModulesList(data.modules);

    // Update Tasks counters
    document.getElementById('overview-tasks-complete').textContent = `${data.entity.tasks_completed} of ${data.entity.total_tasks}`;
    document.getElementById('overview-open-tasks').textContent = data.entity.open_tasks;

  } catch (err) {
    console.error('Failed to load overview', err);
  }
}

function renderBurndownSVG(burndown) {
  const container = document.getElementById('burndown-svg-container');
  if (!container) return;

  const width = container.clientWidth || 650;
  const height = 230;
  const padLeft = 40;
  const padRight = 30;
  const padTop = 20;
  const padBottom = 35;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxVal = 14;
  const count = burndown.length;

  const getX = (idx) => padLeft + (idx / (count - 1)) * plotW;
  const getY = (val) => padTop + plotH - (val / maxVal) * plotH;

  // Active D+4 index
  const currentIdx = burndown.findIndex(b => b.isCurrent);
  const currentX = getX(currentIdx);

  // SVG strings
  let svg = `
    <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible;">
      <!-- Grid Lines -->
      <line x1="${padLeft}" y1="${getY(0)}" x2="${width - padRight}" y2="${getY(0)}" stroke="#E5E1D5" stroke-width="1" />
      <line x1="${padLeft}" y1="${getY(5)}" x2="${width - padRight}" y2="${getY(5)}" stroke="#F0ECE3" stroke-width="1" />
      <line x1="${padLeft}" y1="${getY(10)}" x2="${width - padRight}" y2="${getY(10)}" stroke="#F0ECE3" stroke-width="1" />
      <line x1="${padLeft}" y1="${getY(14)}" x2="${width - padRight}" y2="${getY(14)}" stroke="#F0ECE3" stroke-width="1" />

      <!-- Current Day Shaded Column D+4 -->
      <rect x="${currentX - 16}" y="${padTop}" width="32" height="${plotH}" fill="#EEF2FF" rx="4" />
      <line x1="${currentX}" y1="${padTop}" x2="${currentX}" y2="${padTop + plotH}" stroke="#6366F1" stroke-width="1.5" stroke-dasharray="3,3" />
  `;

  // Draw Plan Line (Dotted Gray)
  let planPoints = [];
  burndown.forEach((b, i) => {
    if (b.plan !== null) planPoints.push(`${getX(i)},${getY(b.plan)}`);
  });
  svg += `<polyline points="${planPoints.join(' ')}" fill="none" stroke="#9CA3AF" stroke-width="2" stroke-dasharray="4,4" />`;

  // Draw Actual Line (Solid Slate)
  let actualPoints = [];
  burndown.forEach((b, i) => {
    if (b.actual !== null) actualPoints.push(`${getX(i)},${getY(b.actual)}`);
  });
  svg += `<polyline points="${actualPoints.join(' ')}" fill="none" stroke="#191B1F" stroke-width="2.5" />`;

  // Draw Projected Line (Dotted Violet)
  let projPoints = [];
  burndown.forEach((b, i) => {
    if (b.projected !== null) projPoints.push(`${getX(i)},${getY(b.projected)}`);
  });
  svg += `<polyline points="${projPoints.join(' ')}" fill="none" stroke="#6366F1" stroke-width="2.5" stroke-dasharray="4,4" />`;

  // Draw Points
  burndown.forEach((b, i) => {
    const x = getX(i);
    // Actual dot
    if (b.actual !== null) {
      svg += `<circle cx="${x}" cy="${getY(b.actual)}" r="4" fill="#191B1F" />`;
    }
    // Projected dot
    if (b.projected !== null && b.actual === null) {
      svg += `<circle cx="${x}" cy="${getY(b.projected)}" r="4" fill="#6366F1" />`;
    }
    // X-axis day label
    svg += `<text x="${x}" y="${height - 10}" text-anchor="middle" font-size="11" font-weight="${b.isCurrent ? '700' : '500'}" fill="${b.isCurrent ? '#6366F1' : '#6B7280'}">${b.day}</text>`;
  });

  // Y-axis labels
  svg += `
    <text x="${padLeft - 8}" y="${getY(0) + 4}" text-anchor="end" font-size="10" fill="#9CA3AF">0</text>
    <text x="${padLeft - 8}" y="${getY(5) + 4}" text-anchor="end" font-size="10" fill="#9CA3AF">5</text>
    <text x="${padLeft - 8}" y="${getY(10) + 4}" text-anchor="end" font-size="10" fill="#9CA3AF">10</text>
    <text x="${padLeft - 8}" y="${getY(14) + 4}" text-anchor="end" font-size="10" fill="#9CA3AF">14</text>
    </svg>
  `;

  container.innerHTML = svg;
}

function renderWorkloadSVG(subprocesses) {
  const container = document.getElementById('workload-svg-container');
  if (!container) return;

  const width = container.clientWidth || 550;
  const height = 190;
  const padLeft = 20;
  const padRight = 20;
  const padTop = 15;
  const padBottom = 30;

  const plotW = width - padLeft - padRight;
  const colW = plotW / subprocesses.length;

  let svg = `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}">`;

  subprocesses.forEach((sp, i) => {
    const cx = padLeft + i * colW + colW / 2;
    const barW = Math.min(colW * 0.4, 28);
    const maxVal = 5;

    const compH = (sp.complete / maxVal) * 110;
    const openH = (sp.open / maxVal) * 110;
    const baseY = height - padBottom;

    if (sp.complete > 0) {
      svg += `
        <rect x="${cx - barW - 2}" y="${baseY - compH}" width="${barW}" height="${compH}" fill="#15803D" rx="2" />
        <text x="${cx - barW / 2 - 2}" y="${baseY - compH - 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#15803D">${sp.complete}</text>
      `;
    }

    if (sp.open > 0) {
      svg += `
        <rect x="${cx + 2}" y="${baseY - openH}" width="${barW}" height="${openH}" fill="#C93B2B" rx="2" />
        <text x="${cx + barW / 2 + 2}" y="${baseY - openH - 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#C93B2B">${sp.open}</text>
      `;
    }

    // Label
    svg += `<text x="${cx}" y="${height - 10}" text-anchor="middle" font-size="11" font-weight="500" fill="#4B5563">${sp.name}</text>`;
  });

  svg += `</svg>`;
  container.innerHTML = svg;
}

function renderModulesList(modules) {
  const container = document.getElementById('overview-modules-list');
  if (!container) return;

  container.innerHTML = modules.map(m => `
    <div class="module-status-card">
      <div class="mod-info">
        <h4>${m.name}</h4>
        <div class="mod-meta">${m.sub} • ${m.assignee} • <strong>${m.pct}%</strong></div>
      </div>
      <div class="mod-actions">
        <span class="status-pill ${m.status === 'In progress' ? 'status-open' : 'badge-risk'}">${m.status}</span>
        <button class="btn btn-outline-sm btn-open-module" data-url="${m.url}">Open &rarr;</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.btn-open-module').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      if (url === 'accrual-prepaid') navigateTo('accruals');
      else if (url === 'recognition-compliance') navigateTo('recognition');
      else if (url === 'flux-variance') navigateTo('flux');
    });
  });
}

// ================= 4. CHECKLIST VIEW & DRAWER =================
async function loadChecklist() {
  try {
    const res = await fetch('/api/checklist');
    const data = await res.json();
    state.checklistData = data;

    document.getElementById('chk-total').textContent = data.total;
    document.getElementById('chk-done').textContent = data.completed;
    document.getElementById('chk-progress').textContent = data.in_progress;
    document.getElementById('chk-todo').textContent = data.not_started;

    renderChecklistGroups(data.tasks);
  } catch (err) {
    console.error('Failed to load checklist', err);
  }
}

function renderChecklistGroups(tasks) {
  const container = document.getElementById('checklist-groups-wrapper');
  if (!container) return;

  // Group by phase
  const phases = {};
  tasks.forEach(t => {
    if (!phases[t.phase]) phases[t.phase] = [];
    phases[t.phase].push(t);
  });

  container.innerHTML = Object.keys(phases).map(phase => {
    const groupTasks = phases[phase];
    const completedCount = groupTasks.filter(t => t.status === 'Done').length;

    return `
      <div class="phase-group-card">
        <div class="phase-group-header">
          <span class="phase-title">${phase}</span>
          <span class="phase-counter">${completedCount}/${groupTasks.length} complete</span>
        </div>
        <table class="tasks-table">
          <tbody>
            ${groupTasks.map(t => `
              <tr class="task-row" data-task-id="${t.id}">
                <td class="task-cell-main">
                  <div class="task-main-title" onclick="openTaskDrawer('${t.id}')">${t.title}</div>
                  <div class="task-sub-desc">${t.description}</div>
                </td>
                <td class="task-assignee">${t.assignee}</td>
                <td class="task-status-cell">
                  ${t.status === 'Done' ? '<span class="badge-done">Done</span>' : `<span class="status-pill status-open">${t.status}</span>`}
                </td>
                <td style="text-align: right; padding: 12px 18px;">
                  ${t.completed_by_ai ? 
                    `<span class="badge-ai-completed" onclick="openTaskDrawer('${t.id}')">✦ COMPLETED BY AI</span>` :
                    `<button class="btn btn-outline-sm" onclick="openTaskDrawer('${t.id}')">Review &rarr;</button>`}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }).join('');
}

// Slide-over Task Drawer
window.openTaskDrawer = function(taskId) {
  if (!state.checklistData) return;
  const task = state.checklistData.tasks.find(t => t.id === taskId);
  if (!task) return;

  state.activeTask = task;
  document.getElementById('drawer-task-title').textContent = task.title;
  document.getElementById('drawer-task-desc').textContent = task.description;

  renderDrawerSubtasks();
  renderDrawerComments();

  document.getElementById('drawer-task-overlay').style.display = 'flex';
};

function renderDrawerSubtasks() {
  if (!state.activeTask) return;
  const listEl = document.getElementById('drawer-subtasks-list');
  const counterEl = document.getElementById('drawer-subtask-counter');
  const subtasks = state.activeTask.subtasks || [];

  const doneCount = subtasks.filter(s => s.is_completed).length;
  counterEl.textContent = `${doneCount} of ${subtasks.length} done - drafted by AI, edit freely`;

  listEl.innerHTML = subtasks.map(s => `
    <div class="subtask-item">
      <div class="st-left">
        <input type="checkbox" ${s.is_completed ? 'checked' : ''} onchange="toggleSubtask('${s.id}')">
        <span style="${s.is_completed ? 'text-decoration:line-through; color:#9CA3AF;' : ''}">${s.title}</span>
      </div>
      <div>
        ${s.is_ai_drafted ? '<span class="badge-ai-pred" style="margin-right:6px;">AI</span>' : ''}
        <button class="btn-outline-sm" style="color:#C93B2B;" onclick="deleteSubtask('${s.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

function renderDrawerComments() {
  if (!state.activeTask) return;
  const listEl = document.getElementById('drawer-comments-list');
  const comments = state.activeTask.comments || [];

  if (comments.length === 0) {
    listEl.innerHTML = `<p class="empty-muted">No comments on this task yet</p>`;
    return;
  }

  listEl.innerHTML = comments.map(c => `
    <div class="activity-item">
      <div><strong>${c.author}</strong> - <span class="act-meta">${c.created_at}</span></div>
      <div style="margin-top:2px;">${c.content}</div>
    </div>
  `).join('');
}

window.toggleSubtask = async function(id) {
  await fetch('/api/checklist/toggle-subtask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
  const sub = state.activeTask.subtasks.find(s => s.id === id);
  if (sub) sub.is_completed = sub.is_completed ? 0 : 1;
  renderDrawerSubtasks();
  showToast('Sub-task updated');
};

window.deleteSubtask = async function(id) {
  await fetch('/api/checklist/delete-subtask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
  state.activeTask.subtasks = state.activeTask.subtasks.filter(s => s.id !== id);
  renderDrawerSubtasks();
  showToast('Sub-task deleted');
};

document.getElementById('btn-add-subtask').addEventListener('click', async () => {
  const input = document.getElementById('input-new-subtask');
  const title = input.value.trim();
  if (!title || !state.activeTask) return;

  const res = await fetch('/api/checklist/add-subtask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: state.activeTask.id, title })
  });
  const data = await res.json();
  state.activeTask.subtasks.push({ id: data.id, title: data.title, is_completed: 0, is_ai_drafted: 0 });
  input.value = '';
  renderDrawerSubtasks();
  showToast('Sub-task added');
});

document.getElementById('btn-post-comment').addEventListener('click', async () => {
  const input = document.getElementById('input-new-comment');
  const content = input.value.trim();
  if (!content || !state.activeTask) return;

  const res = await fetch('/api/checklist/add-comment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: state.activeTask.id, content })
  });
  const data = await res.json();
  state.activeTask.comments.unshift(data);
  input.value = '';
  renderDrawerComments();
  showToast('Comment posted');
});

document.getElementById('btn-close-task-drawer').addEventListener('click', () => {
  document.getElementById('drawer-task-overlay').style.display = 'none';
});

// ================= 5. ACCRUAL & PREPAID =================
async function loadAccruals() {
  try {
    const res = await fetch('/api/accruals');
    const data = await res.json();
    state.accrualsData = data;

    renderAccrualSpendBars(data.spend_categories);
    renderAccrualProposals(data.proposals);
  } catch (err) {
    console.error('Failed to load accruals', err);
  }
}

function renderAccrualSpendBars(categories) {
  const container = document.getElementById('accrual-cat-bars');
  if (!container) return;

  const maxAmount = Math.max(...categories.map(c => c.amount));
  container.innerHTML = categories.map((c, i) => {
    const heightPct = Math.round((c.amount / maxAmount) * 100);
    return `
      <div class="cat-bar-item" title="${c.category}: $${c.amount.toLocaleString()}">
        <div class="bar-pill ${i === 0 ? 'active' : ''}" style="height: ${heightPct}%;"></div>
        <span class="bar-lbl">${c.category.substring(0, 4)}</span>
      </div>
    `;
  }).join('');
}

function renderAccrualProposals(proposals) {
  const container = document.getElementById('accruals-proposals-grid');
  if (!container) return;

  container.innerHTML = proposals.map(p => `
    <div class="proposal-card">
      <div>
        <div class="prop-vendor">${p.vendor_name}</div>
        <div class="prop-type-badge">${p.needs_type}</div>
        <div class="prop-amount">${p.amount_display}</div>
      </div>
      <div class="prop-footer">
        <span class="prop-category">${p.category}</span>
        <span class="prop-action-link" onclick="handleRateCheck('${p.vendor_name}')">${p.action_note} &rarr;</span>
      </div>
    </div>
  `).join('');
}

window.handleRateCheck = function(vendor) {
  showToast(`Checking rate card and contract telemetry for ${vendor}...`);
};

// ================= 6. RECOGNITION & COMPLIANCE (ASC 606 & GATING) =================
async function loadRecognition() {
  try {
    const res = await fetch('/api/recognition');
    const data = await res.json();
    state.recognitionData = data;

    renderRecognitionMonthlySVG(data.monthly_trend);
    renderGatingKanban(data.contracts);
  } catch (err) {
    console.error('Failed to load recognition', err);
  }
}

function renderRecognitionMonthlySVG(monthly) {
  const container = document.getElementById('rec-monthly-svg');
  if (!container) return;

  const width = container.clientWidth || 650;
  const height = 240;
  const padLeft = 30;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 30;

  const plotW = width - padLeft - padRight;
  const colW = plotW / monthly.length;
  const maxVal = 2.0;

  let svg = `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}">`;

  monthly.forEach((m, i) => {
    const cx = padLeft + i * colW + colW / 2;
    const barW = Math.min(colW * 0.35, 14);
    const baseY = height - padBottom;

    const planH = (m.planned / maxVal) * 160;
    const recH = (m.recognised / maxVal) * 160;

    // Highlight August
    if (m.current) {
      svg += `<rect x="${cx - barW - 4}" y="${padTop}" width="${barW * 2 + 8}" height="${height - padTop - padBottom}" fill="#F5F3FF" rx="4" />`;
    }

    // Planned bar (Indigo)
    svg += `<rect x="${cx - barW}" y="${baseY - planH}" width="${barW}" height="${planH}" fill="#4338CA" rx="2" />`;

    // Recognised bar (Green)
    if (m.recognised > 0) {
      svg += `<rect x="${cx + 1}" y="${baseY - recH}" width="${barW}" height="${recH}" fill="#15803D" rx="2" />`;
    }

    svg += `<text x="${cx}" y="${height - 10}" text-anchor="middle" font-size="11" font-weight="${m.current ? '700' : '500'}" fill="${m.current ? '#4338CA' : '#6B7280'}">${m.month}</text>`;
  });

  svg += `</svg>`;
  container.innerHTML = svg;
}

function renderGatingKanban(contracts) {
  const cols = {
    'NEEDS REVIEW': document.getElementById('cards-needs-review'),
    'AUTO-APPLIED': document.getElementById('cards-auto-applied'),
    'STARTED': document.getElementById('cards-started'),
    'DEFERRED': document.getElementById('cards-deferred')
  };

  const counts = {
    'NEEDS REVIEW': 0,
    'AUTO-APPLIED': 0,
    'STARTED': 0,
    'DEFERRED': 0
  };

  // Clear columns
  Object.values(cols).forEach(el => el.innerHTML = '');

  contracts.forEach(c => {
    counts[c.status] = (counts[c.status] || 0) + 1;
    const cardEl = document.createElement('div');
    cardEl.className = 'kanban-card';
    cardEl.onclick = () => openContractDrawer(c.id);

    const isAuto = c.status === 'AUTO-APPLIED';
    cardEl.innerHTML = `
      <div class="flex-between">
        <span class="kc-name">${c.customer_name}</span>
        <span class="status-pill ${isAuto ? 'badge-setup' : 'badge-review'}">${c.status}</span>
      </div>
      <div class="kc-amount">${formatCurrency(c.monthly_amount)}</div>
      <div class="kc-footer">
        <span style="font-size:11px; color:#6B7280;">${c.contract_code}</span>
        <button class="kc-action-btn">${isAuto ? '+ Start' : '+ Defer'}</button>
      </div>
    `;

    if (cols[c.status]) cols[c.status].appendChild(cardEl);
  });

  // Update Counters
  document.getElementById('count-needs-review').textContent = `${counts['NEEDS REVIEW']} contracts`;
  document.getElementById('count-auto-applied').textContent = `${counts['AUTO-APPLIED']} contracts`;
  document.getElementById('count-started').textContent = `${counts['STARTED']} contracts`;
  document.getElementById('count-deferred').textContent = `${counts['DEFERRED']} contracts`;

  // Restore Drop Hints if empty
  if (counts['STARTED'] === 0) {
    cols['STARTED'].innerHTML = '<div class="drop-hint">Drop a card here to start</div>';
  }
  if (counts['DEFERRED'] === 0) {
    cols['DEFERRED'].innerHTML = '<div class="drop-hint">Drop a card here to defer it</div>';
  }
}

// Contract Decision Drawer
window.openContractDrawer = function(contractId) {
  if (!state.recognitionData) return;
  const contract = state.recognitionData.contracts.find(c => c.id === contractId);
  if (!contract) return;

  state.activeContract = contract;
  document.getElementById('drawer-contract-code').textContent = `${contract.contract_code} - GATING - AUG 2026`;
  document.getElementById('drawer-contract-title').textContent = contract.customer_name;
  document.getElementById('dc-arr').textContent = formatCurrency(contract.arr);
  document.getElementById('dc-monthly').textContent = formatCurrency(contract.monthly_amount);
  document.getElementById('dc-schedule').textContent = contract.schedule_info;
  document.getElementById('dc-status').textContent = contract.status;
  document.getElementById('dc-owner').textContent = contract.owner;

  document.getElementById('dc-evidence-list').innerHTML = `
    <li><code>${contract.trigger_rule}</code></li>
    <li><code>${contract.source_evidence}</code></li>
    <li>START: ${contract.start_date} | END: ${contract.end_date} | NET: ${formatCurrency(contract.monthly_amount)}</li>
  `;

  document.getElementById('input-contract-justification').value = contract.user_justification || '';
  document.getElementById('drawer-contract-overlay').style.display = 'flex';
};

document.getElementById('btn-defer-contract').addEventListener('click', async () => {
  if (!state.activeContract) return;
  const justification = document.getElementById('input-contract-justification').value.trim();

  await fetch('/api/recognition/gating-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: state.activeContract.id, action: 'defer', justification })
  });

  state.activeContract.status = 'DEFERRED';
  document.getElementById('drawer-contract-overlay').style.display = 'none';
  showToast(`Contract ${state.activeContract.customer_name} deferred to September`);
  loadRecognition();
});

document.getElementById('btn-confirm-start-contract').addEventListener('click', async () => {
  if (!state.activeContract) return;
  const justification = document.getElementById('input-contract-justification').value.trim();

  await fetch('/api/recognition/gating-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: state.activeContract.id, action: 'start', justification })
  });

  state.activeContract.status = 'STARTED';
  document.getElementById('drawer-contract-overlay').style.display = 'none';
  showToast(`Contract ${state.activeContract.customer_name} confirmed for August recognition`);
  loadRecognition();
});

document.getElementById('btn-accept-all-auto').addEventListener('click', async () => {
  showToast('Accepting all auto-applied revenue recognition items into August schedule...');
});

document.getElementById('btn-close-contract-drawer').addEventListener('click', () => {
  document.getElementById('drawer-contract-overlay').style.display = 'none';
});

// ================= 7. FLUX & VARIANCE (P&L REVIEW & LIVE AI CONTEXT) =================
async function loadFlux() {
  try {
    const res = await fetch('/api/flux');
    const data = await res.json();
    state.fluxData = data;

    renderPnLTable(data.lines);
  } catch (err) {
    console.error('Failed to load flux', err);
  }
}

function renderPnLTable(lines) {
  const tbody = document.getElementById('pnl-table-body');
  if (!tbody) return;

  tbody.innerHTML = lines.map(line => {
    const isParent = line.is_parent;
    const isTotal = line.account_code === 'INC-TOT';
    const deltaClass = line.delta_amount < 0 ? 'danger' : (line.delta_amount > 0 ? 'success' : '');
    const isApproved = line.status === 'APPROVED';

    return `
      <tr class="pnl-row ${isTotal ? 'total-row' : (isParent ? 'category-header' : '')}">
        <td class="${isParent ? '' : 'acc-indent'}">
          <div class="acc-title-cell">
            ${line.is_flagged ? '<span class="flag-dot">●</span>' : ''}
            <span style="cursor:pointer;" onclick="openVarianceDrawer('${line.account_code}')">${line.account_name}</span>
          </div>
        </td>
        <td style="text-align: right;">${line.jul_amount.toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
        <td style="text-align: right;">${line.aug_amount.toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
        <td style="text-align: right;" class="${deltaClass}">${line.delta_amount < 0 ? '-' : ''}$${Math.abs(line.delta_amount).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
        <td style="text-align: right;" class="${deltaClass}">${line.delta_pct > 0 ? '+' : ''}${line.delta_pct}%</td>
        <td style="text-align: center;">
          <span class="status-pill ${isApproved ? 'badge-ontrack' : 'status-open'}">${line.status}</span>
        </td>
        <td style="text-align: right;">
          <button class="btn-outline-sm" onclick="openVarianceDrawer('${line.account_code}')">View &rarr;</button>
        </td>
      </tr>
    `;
  }).join('');
}

// Slide-over Variance Drawer
window.openVarianceDrawer = function(accountCode) {
  if (!state.fluxData) return;
  const line = state.fluxData.lines.find(l => l.account_code === accountCode);
  if (!line) return;

  state.activeVariance = line;
  document.getElementById('var-title').textContent = line.account_name;
  document.getElementById('var-figures').innerHTML = `
    ${line.jul_amount.toLocaleString('en-US', {minimumFractionDigits: 2})} &rarr; ${line.aug_amount.toLocaleString('en-US', {minimumFractionDigits: 2})} | 
    <span class="${line.delta_amount < 0 ? 'danger' : ''}">-$${Math.abs(line.delta_amount).toLocaleString('en-US', {minimumFractionDigits: 2})} (${line.delta_pct}%)</span>
  `;

  document.getElementById('var-explanation-text').textContent = line.ai_explanation;
  document.getElementById('var-context-applied-badge').textContent = line.ai_context_note ? '1 context note applied' : '0 context applied';

  renderVarianceActivity();
  document.getElementById('drawer-variance-overlay').style.display = 'flex';
};

function renderVarianceActivity() {
  const container = document.getElementById('var-activity-list');
  if (!container || !state.fluxData) return;

  const logs = state.fluxData.context_logs.filter(l => l.account_code === (state.activeVariance ? state.activeVariance.account_code : 'INC-REC'));
  if (logs.length === 0) {
    container.innerHTML = '<p class="empty-muted">No context entries on this line yet.</p>';
    return;
  }

  container.innerHTML = logs.map(l => `
    <div class="activity-item">
      <div><strong>AI context added</strong> • ${l.author} • <span class="act-meta">${l.created_at}</span></div>
      <div style="margin-top: 3px; font-weight:600; color:#1F2937;">"${l.note}"</div>
    </div>
  `).join('');
}

// Dynamic AI Context Submission
document.getElementById('btn-submit-ai-context').addEventListener('click', async () => {
  const input = document.getElementById('input-ai-context');
  const note = input.value.trim();
  if (!note || !state.activeVariance) return;

  // Show immediate feedback
  const expBox = document.getElementById('var-ai-box');
  expBox.style.opacity = '0.5';
  showToast('Rewriting explanation with your context...');

  const res = await fetch('/api/flux/add-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_code: state.activeVariance.account_code, note, author: 'Aman Agrawal' })
  });

  const data = await res.json();
  input.value = '';
  expBox.style.opacity = '1';

  // Update AI Explanation in Real Time
  document.getElementById('var-explanation-text').textContent = data.updated_explanation;
  document.getElementById('var-context-applied-badge').textContent = '1 context applied';
  state.activeVariance.ai_explanation = data.updated_explanation;
  state.activeVariance.ai_context_note = note;
  state.fluxData.context_logs.unshift(data.log);

  renderVarianceActivity();
  showToast('Explanation rewritten - context now applies across Flux.');
});

document.getElementById('btn-approve-variance').addEventListener('click', async () => {
  if (!state.activeVariance) return;
  await fetch('/api/flux/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_code: state.activeVariance.account_code })
  });
  state.activeVariance.status = 'APPROVED';
  loadFlux();
  showToast(`${state.activeVariance.account_name} approved`);
});

document.getElementById('btn-mark-reviewed-variance').addEventListener('click', () => {
  showToast('Variance line marked as reviewed');
});

document.getElementById('btn-close-variance-drawer').addEventListener('click', () => {
  document.getElementById('drawer-variance-overlay').style.display = 'none';
});

// Navigate from Flux to Drafted Journal Entries
document.getElementById('btn-goto-draft-jes').addEventListener('click', () => {
  navigateTo('journals');
});

// ================= 8. DRAFTED JOURNAL ENTRIES (BATCH APPROVAL) =================
async function loadJournals() {
  try {
    const res = await fetch('/api/journals');
    const data = await res.json();
    state.journalsData = data;

    document.getElementById('btn-approve-all-jes').textContent = `✦ ${data.ready_batch_text}`;
    renderJournalsTable(data.entries);
  } catch (err) {
    console.error('Failed to load journals', err);
  }
}

function renderJournalsTable(entries) {
  const tbody = document.getElementById('jes-table-body');
  if (!tbody) return;

  tbody.innerHTML = entries.map(je => {
    const isApproved = je.status === 'APPROVED';
    return `
      <tr class="task-row">
        <td><input type="checkbox" class="chk-je-item" data-id="${je.id}" ${isApproved ? 'disabled' : 'checked'}></td>
        <td><strong>#${je.row_number}</strong></td>
        <td><span class="status-pill ${je.entry_type === 'Correction' ? 'badge-risk' : (je.entry_type === 'Accrual' ? 'badge-review' : 'badge-setup')}">${je.entry_type}</span></td>
        <td>
          <div><strong>${je.source_account_code}</strong> ${je.source_account_name}</div>
          <div style="font-size:11px; color:#C93B2B;">-$${Math.abs(je.source_variance_amount).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
        </td>
        <td style="text-align: right; font-weight: 700;">${formatCurrency(je.entry_amount)}</td>
        <td style="font-size: 12px; color:#4B5563;">${je.memo}</td>
        <td style="text-align: center;">
          ${isApproved ? 
            '<span class="status-pill status-connected">POSTED</span>' : 
            `<button class="btn-outline-sm" onclick="approveSingleJE('${je.id}')">Approve</button>`}
        </td>
      </tr>
    `;
  }).join('');
}

window.approveSingleJE = async function(id) {
  await fetch('/api/journals/approve-single', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
  showToast(`Journal Entry #${id} approved to ledger.`);
  loadJournals();
};

document.getElementById('btn-approve-all-jes').addEventListener('click', async () => {
  const btn = document.getElementById('btn-approve-all-jes');
  btn.textContent = 'Posting to Ledger...';
  btn.disabled = true;

  const res = await fetch('/api/journals/approve-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const data = await res.json();

  btn.textContent = '✦ All 24 Approved';
  showToast(data.message);
  loadJournals();
});

document.getElementById('btn-back-to-flux').addEventListener('click', () => {
  navigateTo('flux');
});

// ================= 9. ASK AI COPILOT GLOBAL MODAL =================
const modalAskAI = document.getElementById('modal-ask-ai-overlay');
const btnFloatingAskAI = document.getElementById('btn-floating-ask-ai');
const btnCloseAskAI = document.getElementById('btn-close-ask-ai-modal');
const chatMessages = document.getElementById('ai-chat-messages');
const chatInput = document.getElementById('ai-chat-input');
const btnSendChat = document.getElementById('btn-send-ai-chat');

btnFloatingAskAI.addEventListener('click', () => {
  modalAskAI.style.display = 'flex';
  chatInput.focus();
});

btnCloseAskAI.addEventListener('click', () => {
  modalAskAI.style.display = 'none';
});

async function sendAiMessage(promptText) {
  if (!promptText.trim()) return;

  // Append user message
  const userBubble = document.createElement('div');
  userBubble.className = 'chat-bubble user';
  userBubble.textContent = promptText;
  chatMessages.appendChild(userBubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Typing indicator
  const aiBubble = document.createElement('div');
  aiBubble.className = 'chat-bubble ai';
  aiBubble.innerHTML = `<em>Querying Enterprise Brain across 14 connected systems...</em>`;
  chatMessages.appendChild(aiBubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    const res = await fetch('/api/ai/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptText })
    });
    const data = await res.json();
    aiBubble.innerHTML = `<p>${data.response.replace(/\n/g, '<br>')}</p>`;
  } catch (err) {
    aiBubble.innerHTML = `<p>Enterprise Brain is synchronizing live balances. Please try again shortly.</p>`;
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

btnSendChat.addEventListener('click', () => {
  const text = chatInput.value;
  chatInput.value = '';
  sendAiMessage(text);
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = chatInput.value;
    chatInput.value = '';
    sendAiMessage(text);
  }
});

document.querySelectorAll('.quick-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    sendAiMessage(chip.dataset.prompt);
  });
});

// Topbar "All Entities" Switcher
document.getElementById('btn-switch-hub').addEventListener('click', () => {
  navigateTo('entities');
});

// Topbar AI Insight Top
document.getElementById('btn-ai-insight-top').addEventListener('click', () => {
  modalAskAI.style.display = 'flex';
  sendAiMessage('Summarize current close forecast and blockers');
});

// Sidebar Navigation Bindings
document.querySelectorAll('.tree-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(item.dataset.view);
  });
});

document.getElementById('nav-entities').addEventListener('click', (e) => {
  e.preventDefault();
  navigateTo('entities');
});

document.querySelectorAll('.nav-item[data-view]').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(item.dataset.view);
  });
});

// Global Keyboard Shortcut: ⌘K for Ask AI
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    modalAskAI.style.display = 'flex';
    chatInput.focus();
  }
});

// Initialization
window.addEventListener('DOMContentLoaded', () => {
  navigateTo('entities');
});
