// views.js — All 8 dashboard view rendering functions
import { dagVertices, VERTEX_TYPES, loops, tokens, recentMints, dfaos, proposals, reputation, seasons, ecosystemApps, decayHistory, services, formatTime, formatDate, formatNumber } from './data.js';
import { DAGRenderer } from './dag-renderer.js';
import { createLineChart, createBarChart, createDoughnutChart, createRadarChart, createSparkline, CHART_COLORS } from './charts.js';

let dagRenderer = null;
let chartInstances = [];

function destroyCharts() {
  chartInstances.forEach(c => { try { c.destroy(); } catch(e) {} });
  chartInstances = [];
  if (dagRenderer) { dagRenderer.destroy(); dagRenderer = null; }
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  });
  children.forEach(c => {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  });
  return e;
}

// ============================================================
// VIEW 1: DAG EXPLORER
// ============================================================
export function renderDAGView(container) {
  destroyCharts();
  container.innerHTML = '';

  const header = el('div', { class: 'view-header' }, [
    el('div', {}, [
      el('h2', { class: 'view-title' }, ['DAG Substrate Explorer']),
      el('p', { class: 'view-subtitle' }, ['Permissionless directed acyclic graph — the foundational ledger']),
    ]),
  ]);
  container.appendChild(header);

  // Filter bar
  const filterBar = el('div', { class: 'dag-filters' });
  const allTypes = Object.keys(VERTEX_TYPES);
  let activeFilters = new Set(allTypes);

  const filterAll = el('button', { class: 'filter-chip active', onClick: () => {
    activeFilters = new Set(allTypes);
    updateFilterUI();
    dagRenderer?.setFilters([...activeFilters]);
    updateStats();
  } }, ['All']);
  filterBar.appendChild(filterAll);

  const filterChips = {};
  allTypes.forEach(type => {
    const info = VERTEX_TYPES[type];
    const chip = el('button', { class: 'filter-chip active', onClick: () => {
      if (activeFilters.has(type)) activeFilters.delete(type);
      else activeFilters.add(type);
      updateFilterUI();
      dagRenderer?.setFilters([...activeFilters]);
      updateStats();
    } }, [info.label]);
    filterChips[type] = chip;
    filterBar.appendChild(chip);
  });

  function updateFilterUI() {
    filterAll.className = 'filter-chip' + (activeFilters.size === allTypes.length ? ' active' : '');
    Object.entries(filterChips).forEach(([t, chip]) => {
      chip.className = 'filter-chip' + (activeFilters.has(t) ? ' active' : '');
    });
  }

  container.appendChild(filterBar);

  // DAG layout wrapper
  const dagLayout = el('div', { class: 'dag-view-layout' });

  // Canvas container
  const dagContainer = el('div', { class: 'dag-container' });
  const canvas = el('canvas', { class: 'dag-canvas' });
  dagContainer.appendChild(canvas);

  // Stats overlay
  const statsOverlay = el('div', { class: 'dag-stats' });
  const statTotal = el('div', { class: 'dag-stat' }, [el('span', {}, ['Vertices ']), el('span', { class: 'dag-stat-value', id: 'dag-stat-total' }, ['0'])]);
  const statRate = el('div', { class: 'dag-stat' }, [el('span', {}, ['Confirmed ']), el('span', { class: 'dag-stat-value', id: 'dag-stat-rate' }, ['0%'])]);
  const statTips = el('div', { class: 'dag-stat' }, [el('span', {}, ['Tips ']), el('span', { class: 'dag-stat-value', id: 'dag-stat-tips' }, ['0'])]);
  statsOverlay.append(statTotal, statRate, statTips);
  dagContainer.appendChild(statsOverlay);

  // Controls
  const controls = el('div', { class: 'dag-controls' });
  controls.appendChild(el('button', { onClick: () => dagRenderer?.zoomIn(), 'aria-label': 'Zoom in', html: '+' }));
  controls.appendChild(el('button', { onClick: () => dagRenderer?.zoomOut(), 'aria-label': 'Zoom out', html: '−' }));
  controls.appendChild(el('button', { onClick: () => dagRenderer?.resetView(), 'aria-label': 'Reset view', html: '⟳' }));
  dagContainer.appendChild(controls);

  dagLayout.appendChild(dagContainer);
  container.appendChild(dagLayout);

  // Slide panel
  const overlay = el('div', { class: 'panel-overlay', onClick: closePanel });
  const panel = el('div', { class: 'slide-panel' });
  panel.innerHTML = `
    <div class="slide-panel-header">
      <span class="view-title" id="panel-title">Node Details</span>
      <button class="header-icon-btn" onclick="this.closest('.slide-panel').classList.remove('open');document.querySelector('.panel-overlay').classList.remove('visible')" aria-label="Close panel">✕</button>
    </div>
    <div class="slide-panel-body" id="panel-body"></div>
  `;
  container.appendChild(overlay);
  container.appendChild(panel);

  function closePanel() {
    panel.classList.remove('open');
    overlay.classList.remove('visible');
  }

  function openPanel(nodeData) {
    const title = panel.querySelector('#panel-title');
    const body = panel.querySelector('#panel-body');
    const info = VERTEX_TYPES[nodeData.type] || { label: nodeData.type, badge: 'teal' };

    title.textContent = nodeData.id;
    body.innerHTML = `
      <div style="margin-bottom: var(--space-4);">
        <span class="badge badge-${info.badge}">${info.label}</span>
        ${nodeData.confirmed ? '<span class="badge badge-success" style="margin-left: var(--space-2);">✓ Confirmed</span>' : '<span class="badge badge-error" style="margin-left: var(--space-2);">Unconfirmed</span>'}
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--space-3);">
        <div class="formula-factor"><div class="factor-label">Actor</div><div class="td-mono" style="color:var(--color-text);word-break:break-all;">${nodeData.actor}</div></div>
        <div class="formula-factor"><div class="factor-label">Timestamp</div><div class="td-mono" style="color:var(--color-text);">${new Date(nodeData.timestamp).toLocaleString()}</div></div>
        ${nodeData.claim ? `<div class="formula-factor"><div class="factor-label">Claim</div><div style="color:var(--color-text);font-size:var(--text-xs);">${nodeData.claim}</div></div>` : ''}
        ${nodeData.deltaS !== null ? `<div class="formula-factor"><div class="factor-label">ΔS</div><div class="td-mono" style="color:var(--color-gold);">${nodeData.deltaS}</div></div>` : ''}
        ${nodeData.xpAmount !== null ? `<div class="formula-factor"><div class="factor-label">XP Minted</div><div class="td-mono" style="color:var(--color-gold);">${nodeData.xpAmount}</div></div>` : ''}
        <div class="formula-factor"><div class="factor-label">Parents</div><div class="td-mono" style="color:var(--color-text);">${nodeData.parents.length > 0 ? nodeData.parents.join(', ') : 'None (genesis)'}</div></div>
      </div>
    `;
    panel.classList.add('open');
    overlay.classList.add('visible');
  }

  // Initialize DAG
  requestAnimationFrame(() => {
    dagRenderer = new DAGRenderer(canvas, openPanel);
    updateStats();
  });

  function updateStats() {
    if (!dagRenderer) return;
    const stats = dagRenderer.getStats();
    const s1 = document.getElementById('dag-stat-total');
    const s2 = document.getElementById('dag-stat-rate');
    const s3 = document.getElementById('dag-stat-tips');
    if (s1) s1.textContent = stats.total;
    if (s2) s2.textContent = stats.rate + '%';
    if (s3) s3.textContent = stats.tips;
  }
}

// ============================================================
// VIEW 2: LOOP LIFECYCLE
// ============================================================
export function renderLoopsView(container) {
  destroyCharts();
  container.innerHTML = '';

  const header = el('div', { class: 'view-header' }, [
    el('div', {}, [
      el('h2', { class: 'view-title' }, ['Loop Lifecycle']),
      el('p', { class: 'view-subtitle' }, ['Track entropy reduction claims from submission to XP minting']),
    ]),
    el('button', { class: 'btn btn-primary btn-sm' }, ['+ New Loop']),
  ]);
  container.appendChild(header);

  // KPI cards
  const stats = {
    open: loops.filter(l => l.status === 'open').length,
    measuring: loops.filter(l => l.status === 'measuring').length,
    validating: loops.filter(l => l.status === 'validating').length,
    closed: loops.filter(l => l.status === 'closed').length,
    failed: loops.filter(l => l.status === 'failed').length,
  };
  const kpiGrid = el('div', { class: 'kpi-grid' });
  [
    { label: 'Open', value: stats.open, cls: 'teal' },
    { label: 'Measuring', value: stats.measuring, cls: '' },
    { label: 'Validating', value: stats.validating, cls: '' },
    { label: 'Closed', value: stats.closed, cls: 'teal' },
    { label: 'Failed', value: stats.failed, cls: '' },
  ].forEach(k => {
    kpiGrid.appendChild(el('div', { class: 'kpi-card' }, [
      el('div', { class: 'kpi-label' }, [k.label]),
      el('div', { class: `kpi-value ${k.cls}` }, [String(k.value)]),
    ]));
  });
  container.appendChild(kpiGrid);

  // Status filter tabs
  const tabBar = el('div', { class: 'tab-bar' });
  let activeTab = 'all';
  const tabs = ['all', 'open', 'measuring', 'validating', 'closed', 'failed'];
  const tabEls = {};
  tabs.forEach(t => {
    const tab = el('button', { class: 'tab-item' + (t === 'all' ? ' active' : ''), onClick: () => {
      activeTab = t;
      Object.values(tabEls).forEach(te => te.classList.remove('active'));
      tab.classList.add('active');
      renderTable();
    } }, [t.charAt(0).toUpperCase() + t.slice(1)]);
    tabEls[t] = tab;
    tabBar.appendChild(tab);
  });
  container.appendChild(tabBar);

  // Table
  const tableWrap = el('div', { class: 'table-container', style: 'max-height: 500px; overflow-y: auto;' });
  container.appendChild(tableWrap);

  function renderTable() {
    const filtered = activeTab === 'all' ? loops : loops.filter(l => l.status === activeTab);
    const statusBadge = (s) => {
      const map = { open: 'teal', measuring: 'blue', validating: 'warning', closed: 'success', failed: 'error' };
      return `<span class="badge badge-${map[s] || 'teal'}">${s}</span>`;
    };
    tableWrap.innerHTML = `
      <table>
        <thead><tr>
          <th>Loop ID</th>
          <th>Claim</th>
          <th>Domain</th>
          <th>Status</th>
          <th>ΔS</th>
          <th>XP Minted</th>
          <th>Validators</th>
        </tr></thead>
        <tbody>
          ${filtered.map(l => `
            <tr>
              <td class="td-mono">${l.id}</td>
              <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${l.claim}">${l.claim}</td>
              <td><span class="badge badge-teal">${l.domain}</span></td>
              <td>${statusBadge(l.status)}</td>
              <td class="td-mono" style="color:${l.deltaS ? 'var(--color-gold)' : 'var(--color-text-faint)'};">${l.deltaS !== null ? l.deltaS.toFixed(3) : '—'}</td>
              <td class="td-mono" style="color:${l.xpMinted ? 'var(--color-gold)' : 'var(--color-text-faint)'};">${l.xpMinted !== null ? l.xpMinted.toFixed(1) : '—'}</td>
              <td class="td-mono">${l.validators.length > 0 ? l.validators.length : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  renderTable();
}

// ============================================================
// VIEW 3: XP MINTING & TOKENS
// ============================================================
export function renderXPView(container) {
  destroyCharts();
  container.innerHTML = '';

  const header = el('div', { class: 'view-header' }, [
    el('div', {}, [
      el('h2', { class: 'view-title' }, ['XP Minting & Tokens']),
      el('p', { class: 'view-subtitle' }, ['Non-transferable experience points and token economy']),
    ]),
  ]);
  container.appendChild(header);

  // XP Hero
  const hero = el('div', { class: 'xp-hero' });
  hero.innerHTML = `
    <div class="xp-hero-label">Total XP Balance</div>
    <div class="xp-hero-value" id="xp-counter">0</div>
    <div class="xp-hero-sub">+1,247 XP this season • Level ${reputation.level} ${reputation.title}</div>
  `;
  container.appendChild(hero);

  // Animate counter
  requestAnimationFrame(() => {
    const counter = document.getElementById('xp-counter');
    if (!counter) return;
    let current = 0;
    const target = 42847.25;
    const duration = 1200;
    const start = performance.now();
    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      current = target * eased;
      counter.textContent = current.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });

  // Token cards grid
  const tokensHeader = el('div', { style: 'margin-bottom: var(--space-3);' }, [
    el('h3', { class: 'card-title' }, ['Token Balances']),
  ]);
  container.appendChild(tokensHeader);

  const tokenGrid = el('div', { class: 'grid-3', style: 'margin-bottom: var(--space-5);' });
  tokens.forEach(t => {
    const card = el('div', { class: 'token-card' });
    card.innerHTML = `
      <div class="token-icon" style="background:${t.bg};color:${t.color};">${t.symbol}</div>
      <div class="token-info">
        <div class="token-name">${t.name}</div>
        <div class="token-desc">${t.desc}</div>
      </div>
      <div>
        <div class="token-balance" style="color:${t.color};">${typeof t.balance === 'number' && t.balance > 100 ? t.balance.toLocaleString('en-US', {minimumFractionDigits: t.balance % 1 ? 2 : 0}) : t.balance}</div>
        <div class="kpi-delta positive" style="text-align:right;">${t.change}</div>
      </div>
    `;

    // Add sparkline
    const sparkWrap = el('div', { style: 'height:24px;width:60px;position:absolute;bottom:8px;right:8px;opacity:0.5;' });
    card.style.position = 'relative';
    // We'll skip absolute positioning for cleaner look
    tokenGrid.appendChild(card);
  });
  container.appendChild(tokenGrid);

  // XP Formula section
  const formulaSection = el('div', { class: 'formula-card', style: 'margin-bottom: var(--space-5);' });
  formulaSection.innerHTML = `
    <div class="card-title">XP Formula</div>
    <div class="formula-display">XP = R × F × ΔS × (w · E) × log(1/Tₛ)</div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:var(--space-2);font-size:var(--text-xs);color:var(--color-text-muted);text-align:center;">
      <div><strong style="color:var(--color-primary);">R</strong><br>Reputation</div>
      <div><strong style="color:var(--color-primary);">F</strong><br>Frequency</div>
      <div><strong style="color:var(--color-gold);">ΔS</strong><br>Entropy Change</div>
      <div><strong style="color:var(--color-primary);">w·E</strong><br>Weight × Evidence</div>
      <div><strong style="color:var(--color-primary);">Tₛ</strong><br>Time Factor</div>
    </div>
  `;
  container.appendChild(formulaSection);

  // Recent mints table
  const mintsHeader = el('div', { style: 'margin-bottom: var(--space-3);' }, [
    el('h3', { class: 'card-title' }, ['Recent Mint Events']),
  ]);
  container.appendChild(mintsHeader);

  const mintsTable = el('div', { class: 'table-container' });
  mintsTable.innerHTML = `
    <table>
      <thead><tr>
        <th>Mint ID</th>
        <th>Loop</th>
        <th>Amount</th>
        <th>R</th>
        <th>F</th>
        <th>ΔS</th>
        <th>w·E</th>
        <th>Tₛ</th>
        <th>Time</th>
      </tr></thead>
      <tbody>
        ${recentMints.map(m => `
          <tr>
            <td class="td-mono">${m.id}</td>
            <td class="td-mono">${m.loopId}</td>
            <td class="td-mono" style="color:var(--color-gold);font-weight:600;">+${m.amount.toFixed(1)}</td>
            <td class="td-mono">${m.R}</td>
            <td class="td-mono">${m.F}</td>
            <td class="td-mono" style="color:var(--color-gold);">${m.deltaS}</td>
            <td class="td-mono">${m.wE}</td>
            <td class="td-mono">${m.Ts}</td>
            <td class="td-mono">${formatDate(m.timestamp)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  container.appendChild(mintsTable);

  // XP over time chart
  const chartCard = el('div', { class: 'chart-card', style: 'margin-top: var(--space-5);' });
  chartCard.innerHTML = `
    <div class="chart-card-header">
      <span class="card-title">XP Growth Over Time</span>
    </div>
    <div class="chart-wrap" style="height:200px;">
      <canvas id="xp-growth-chart"></canvas>
    </div>
  `;
  container.appendChild(chartCard);

  requestAnimationFrame(() => {
    const canvas = document.getElementById('xp-growth-chart');
    if (canvas) {
      chartInstances.push(createLineChart(
        canvas,
        ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'],
        [{ label: 'XP Balance', data: [11780, 15010, 18240, 22895, 29925, 36290, 42847], color: CHART_COLORS.gold }]
      ));
    }
  });
}

// ============================================================
// VIEW 4: DFAO REGISTRY
// ============================================================
export function renderDFAOView(container) {
  destroyCharts();
  container.innerHTML = '';

  const header = el('div', { class: 'view-header' }, [
    el('div', {}, [
      el('h2', { class: 'view-title' }, ['DFAO Registry']),
      el('p', { class: 'view-subtitle' }, ['Decentralized Fractal Autonomous Organizations — nested governance']),
    ]),
    el('button', { class: 'btn btn-primary btn-sm' }, ['+ Register DFAO']),
  ]);
  container.appendChild(header);

  // Stats
  function countAll(nodes) {
    let c = nodes.length;
    nodes.forEach(n => { if (n.children) c += countAll(n.children); });
    return c;
  }
  const totalDFAOs = countAll(dfaos);
  function sumMembers(nodes) {
    let m = 0;
    nodes.forEach(n => { m += n.members; if (n.children) m += sumMembers(n.children); });
    return m;
  }
  const totalMembers = sumMembers(dfaos);

  const kpiGrid = el('div', { class: 'kpi-grid', style: 'margin-bottom: var(--space-5);' });
  [
    { label: 'Total DFAOs', value: totalDFAOs },
    { label: 'Total Members', value: formatNumber(totalMembers) },
    { label: 'Nesting Depth', value: '3 levels' },
    { label: 'Active', value: '7' },
  ].forEach(k => {
    kpiGrid.appendChild(el('div', { class: 'kpi-card' }, [
      el('div', { class: 'kpi-label' }, [k.label]),
      el('div', { class: 'kpi-value teal' }, [String(k.value)]),
    ]));
  });
  container.appendChild(kpiGrid);

  // Render tree
  const tree = el('div', { class: 'dfao-tree' });
  function renderNode(node, depth = 0) {
    const scaleMap = { global: 'purple', regional: 'blue', local: 'teal', micro: 'gold' };
    const statusMap = { active: 'success', hybrid: 'warning', shadow: 'error' };

    const dfaoNode = el('div', { class: 'dfao-node', style: `margin-left: ${depth * 24}px;` });
    const hasChildren = node.children && node.children.length > 0;

    const header = el('div', { class: 'dfao-header' });
    header.innerHTML = `
      <div class="dfao-info">
        <div class="dfao-icon">${depth === 0 ? '🌐' : depth === 1 ? '🏛️' : '📍'}</div>
        <div>
          <div class="dfao-name">${node.name}</div>
          <div class="dfao-meta">${formatNumber(node.members)} members • Rep: ${node.reputation}/10</div>
        </div>
      </div>
      <div class="dfao-badges">
        <span class="badge badge-${scaleMap[node.scale] || 'teal'}">${node.scale}</span>
        <span class="badge badge-${statusMap[node.status] || 'teal'}">${node.status}</span>
        ${hasChildren ? `<span class="dfao-chevron">▶</span>` : ''}
      </div>
    `;

    dfaoNode.appendChild(header);

    if (hasChildren) {
      const childrenWrap = el('div', { class: 'dfao-children' });
      node.children.forEach(child => {
        childrenWrap.appendChild(renderNode(child, depth + 1));
      });
      dfaoNode.appendChild(childrenWrap);

      header.addEventListener('click', () => {
        childrenWrap.classList.toggle('expanded');
        const chevron = header.querySelector('.dfao-chevron');
        if (chevron) chevron.classList.toggle('open');
      });
    }

    return dfaoNode;
  }

  dfaos.forEach(d => tree.appendChild(renderNode(d)));
  container.appendChild(tree);
}

// ============================================================
// VIEW 5: GOVERNANCE
// ============================================================
export function renderGovernanceView(container) {
  destroyCharts();
  container.innerHTML = '';

  const header = el('div', { class: 'view-header' }, [
    el('div', {}, [
      el('h2', { class: 'view-title' }, ['Governance']),
      el('p', { class: 'view-subtitle' }, ['Reputation-weighted proposals and voting']),
    ]),
    el('button', { class: 'btn btn-primary btn-sm' }, ['+ New Proposal']),
  ]);
  container.appendChild(header);

  // Stats
  const activeProposals = proposals.filter(p => p.status === 'active');
  const kpiGrid = el('div', { class: 'kpi-grid', style: 'margin-bottom: var(--space-5);' });
  [
    { label: 'Active Proposals', value: activeProposals.length },
    { label: 'Total Proposals', value: proposals.length },
    { label: 'Participation Rate', value: '81.2%' },
    { label: 'Quorum Threshold', value: '5,000' },
  ].forEach(k => {
    kpiGrid.appendChild(el('div', { class: 'kpi-card' }, [
      el('div', { class: 'kpi-label' }, [k.label]),
      el('div', { class: 'kpi-value' }, [String(k.value)]),
    ]));
  });
  container.appendChild(kpiGrid);

  // Tabs
  const tabBar = el('div', { class: 'tab-bar' });
  let activeTab = 'active';
  const tabMap = { active: 'Active', passed: 'Passed', rejected: 'Rejected', all: 'All' };
  const tabEls = {};
  Object.entries(tabMap).forEach(([key, label]) => {
    const tab = el('button', { class: 'tab-item' + (key === 'active' ? ' active' : ''), onClick: () => {
      activeTab = key;
      Object.values(tabEls).forEach(te => te.classList.remove('active'));
      tab.classList.add('active');
      renderProposals();
    } }, [label]);
    tabEls[key] = tab;
    tabBar.appendChild(tab);
  });
  container.appendChild(tabBar);

  const listWrap = el('div', { id: 'proposals-list' });
  container.appendChild(listWrap);

  function renderProposals() {
    const filtered = activeTab === 'all' ? proposals : proposals.filter(p => p.status === activeTab);
    listWrap.innerHTML = '';
    filtered.forEach(p => {
      const total = p.votesFor + p.votesAgainst;
      const forPct = total > 0 ? (p.votesFor / total * 100) : 0;
      const againstPct = total > 0 ? (p.votesAgainst / total * 100) : 0;
      const quorumPct = Math.min((p.totalVoters / p.quorum * 100), 100);
      const statusBadge = p.status === 'active' ? 'teal' : p.status === 'passed' ? 'success' : 'error';

      const card = el('div', { class: 'proposal-card' });
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2);">
          <span class="badge badge-${statusBadge}">${p.status}</span>
          <span class="td-mono" style="color:var(--color-text-faint);">${p.id}</span>
        </div>
        <div class="proposal-title">${p.title}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-bottom:var(--space-3);max-width:65ch;">${p.desc}</div>
        <div class="proposal-meta">
          <span>By ${p.author}</span>
          <span>Created ${formatDate(p.createdAt)}</span>
          ${p.timeRemaining ? `<span style="color:var(--color-warning);">&#9201; ${p.timeRemaining} remaining</span>` : ''}
        </div>
        <div class="vote-bar">
          <div class="vote-for" style="width:${forPct}%"></div>
          <div class="vote-against" style="width:${againstPct}%"></div>
        </div>
        <div class="vote-labels">
          <span style="color:var(--color-success);">For: ${p.votesFor.toLocaleString()} (${forPct.toFixed(1)}%)</span>
          <span style="color:var(--color-error);">Against: ${p.votesAgainst.toLocaleString()} (${againstPct.toFixed(1)}%)</span>
        </div>
        <div style="margin-top:var(--space-3);">
          <div style="display:flex;justify-content:space-between;font-size:0.625rem;color:var(--color-text-faint);margin-bottom:var(--space-1);">
            <span>Quorum Progress</span>
            <span>${p.totalVoters.toLocaleString()} / ${p.quorum.toLocaleString()}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${quorumPct}%"></div></div>
        </div>
      `;
      listWrap.appendChild(card);
    });
  }
  renderProposals();
}

// ============================================================
// VIEW 6: REPUTATION & CREDENTIALS
// ============================================================
export function renderReputationView(container) {
  destroyCharts();
  container.innerHTML = '';

  const header = el('div', { class: 'view-header' }, [
    el('div', {}, [
      el('h2', { class: 'view-title' }, ['Reputation & Credentials']),
      el('p', { class: 'view-subtitle' }, ['Your entropy reduction track record across domains']),
    ]),
  ]);
  container.appendChild(header);

  // Level display
  const levelDisplay = el('div', { class: 'level-display' });
  const xpProgress = (reputation.currentXpInLevel / reputation.xpToNextLevel * 100).toFixed(1);
  levelDisplay.innerHTML = `
    <div class="level-number">${reputation.level}</div>
    <div class="level-info">
      <div class="level-title">${reputation.title}</div>
      <div class="level-subtitle">${reputation.currentXpInLevel.toLocaleString()} / ${reputation.xpToNextLevel.toLocaleString()} XP to Level ${reputation.level + 1}</div>
      <div class="progress-bar"><div class="progress-fill gold" style="width:${xpProgress}%"></div></div>
    </div>
  `;
  container.appendChild(levelDisplay);

  // Radar + Domains grid
  const section = el('div', { class: 'reputation-section', style: 'margin-bottom: var(--space-5);' });

  // Radar chart
  const radarCard = el('div', { class: 'chart-card' });
  radarCard.innerHTML = `
    <div class="chart-card-header"><span class="card-title">Domain Expertise</span></div>
    <div class="chart-wrap" style="height:280px;max-width:350px;margin:0 auto;">
      <canvas id="reputation-radar"></canvas>
    </div>
  `;
  section.appendChild(radarCard);

  // Domain scores list
  const domainCard = el('div', { class: 'card' });
  domainCard.innerHTML = `
    <div class="card-title" style="margin-bottom:var(--space-4);">Domain Scores</div>
    ${reputation.domains.map(d => `
      <div style="margin-bottom:var(--space-3);">
        <div style="display:flex;justify-content:space-between;margin-bottom:var(--space-1);">
          <span style="font-size:var(--text-xs);">${d.name}</span>
          <span class="td-mono" style="color:var(--color-primary);font-size:var(--text-xs);">${d.score}/10</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${d.score * 10}%"></div></div>
      </div>
    `).join('')}
  `;
  section.appendChild(domainCard);
  container.appendChild(section);

  // Badges
  const badgesTitle = el('h3', { class: 'card-title', style: 'margin-bottom: var(--space-3);' }, ['Badges Earned']);
  container.appendChild(badgesTitle);

  const badgeGrid = el('div', { class: 'badge-grid', style: 'margin-bottom: var(--space-5);' });
  reputation.badges.forEach(b => {
    const item = el('div', { class: 'badge-item' });
    item.innerHTML = `
      <div class="badge-item-icon" style="background:${b.color}20;color:${b.color};">${b.icon}</div>
      <div class="badge-item-name">${b.name}</div>
    `;
    badgeGrid.appendChild(item);
  });
  container.appendChild(badgeGrid);

  // Init radar chart
  requestAnimationFrame(() => {
    const canvas = document.getElementById('reputation-radar');
    if (canvas) {
      chartInstances.push(createRadarChart(
        canvas,
        reputation.domains.map(d => d.name.split(' ').slice(0, 2).join(' ')),
        reputation.domains.map(d => d.score)
      ));
    }
  });
}

// ============================================================
// VIEW 7: TEMPORAL / SEASONS
// ============================================================
export function renderTemporalView(container) {
  destroyCharts();
  container.innerHTML = '';

  const header = el('div', { class: 'view-header' }, [
    el('div', {}, [
      el('h2', { class: 'view-title' }, ['Temporal / Seasons']),
      el('p', { class: 'view-subtitle' }, ['Seasonal cycles, decay mechanics, and time-based incentives']),
    ]),
  ]);
  container.appendChild(header);

  // Current season card
  const currentSeason = seasons[0];
  const seasonCard = el('div', { class: 'season-card', style: 'margin-bottom: var(--space-5);' });

  const now = new Date();
  const end = new Date(currentSeason.endDate);
  const start = new Date(currentSeason.startDate);
  const daysRemaining = Math.max(0, Math.ceil((end - now) / 86400000));
  const totalDays = Math.ceil((end - start) / 86400000);
  const progressPct = ((totalDays - daysRemaining) / totalDays * 100).toFixed(1);

  seasonCard.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-4);">
      <div>
        <div style="font-size:var(--text-lg);font-weight:700;margin-bottom:var(--space-1);">${currentSeason.name}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-muted);">${formatDate(currentSeason.startDate)} → ${formatDate(currentSeason.endDate)}</div>
      </div>
      <span class="badge badge-success">● Active</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-4);margin-bottom:var(--space-4);">
      <div>
        <div class="kpi-label">Days Left</div>
        <div class="kpi-value teal">${daysRemaining}</div>
      </div>
      <div>
        <div class="kpi-label">Decay Rate</div>
        <div class="kpi-value">${(currentSeason.decayRate * 100)}%</div>
      </div>
      <div>
        <div class="kpi-label">XP Minted</div>
        <div class="kpi-value gold">${formatNumber(currentSeason.totalXpMinted)}</div>
      </div>
      <div>
        <div class="kpi-label">Loops Closed</div>
        <div class="kpi-value">${currentSeason.closedLoops}</div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:0.625rem;color:var(--color-text-faint);margin-bottom:var(--space-1);">
      <span>Season Progress</span>
      <span>${progressPct}%</span>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${progressPct}%"></div></div>
  `;
  container.appendChild(seasonCard);

  // Decay chart
  const decayCard = el('div', { class: 'chart-card', style: 'margin-bottom: var(--space-5);' });
  decayCard.innerHTML = `
    <div class="chart-card-header">
      <span class="card-title">Monthly Decay (5%)</span>
      <span class="badge badge-error">−${decayHistory[decayHistory.length-1].decayed.toLocaleString()} XP last month</span>
    </div>
    <div class="chart-wrap" style="height:200px;">
      <canvas id="decay-chart"></canvas>
    </div>
  `;
  container.appendChild(decayCard);

  // Season history
  const historyTitle = el('h3', { class: 'card-title', style: 'margin-bottom: var(--space-3);' }, ['Season History']);
  container.appendChild(historyTitle);

  const historyTable = el('div', { class: 'table-container' });
  historyTable.innerHTML = `
    <table>
      <thead><tr>
        <th>Season</th>
        <th>Period</th>
        <th>Status</th>
        <th>XP Minted</th>
        <th>Loops Closed</th>
        <th>Decay Rate</th>
      </tr></thead>
      <tbody>
        ${seasons.map(s => `
          <tr>
            <td style="font-weight:600;">${s.name}</td>
            <td class="td-mono">${formatDate(s.startDate)} → ${formatDate(s.endDate)}</td>
            <td><span class="badge badge-${s.status === 'active' ? 'success' : 'teal'}">${s.status}</span></td>
            <td class="td-mono" style="color:var(--color-gold);">${s.totalXpMinted.toLocaleString()}</td>
            <td class="td-mono">${s.closedLoops}</td>
            <td class="td-mono">${(s.decayRate * 100)}%</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  container.appendChild(historyTable);

  // Init decay chart
  requestAnimationFrame(() => {
    const canvas = document.getElementById('decay-chart');
    if (canvas) {
      chartInstances.push(createBarChart(
        canvas,
        decayHistory.map(d => d.month),
        [
          { label: 'Decayed XP', data: decayHistory.map(d => d.decayed), color: CHART_COLORS.error },
        ]
      ));
    }
  });
}

// ============================================================
// VIEW 8: ECOSYSTEM APPS
// ============================================================
export function renderEcosystemView(container) {
  destroyCharts();
  container.innerHTML = '';

  const header = el('div', { class: 'view-header' }, [
    el('div', {}, [
      el('h2', { class: 'view-title' }, ['Ecosystem Apps']),
      el('p', { class: 'view-subtitle' }, ['Applications built on the Extropy Engine substrate']),
    ]),
  ]);
  container.appendChild(header);

  // App grid
  const grid = el('div', { class: 'app-grid', style: 'margin-bottom: var(--space-8);' });
  ecosystemApps.forEach(app => {
    const card = el('div', { class: 'app-card' });
    card.innerHTML = `
      <div class="app-card-header">
        <div class="app-icon" style="background:${app.color}20;color:${app.color};">${app.icon}</div>
        <div>
          <div class="app-name">${app.name}</div>
          <span class="badge badge-${app.status === 'active' ? 'success' : 'warning'}">${app.status === 'active' ? '● Active' : '◎ Coming Soon'}</span>
        </div>
      </div>
      <div class="app-desc">${app.desc}</div>
      ${app.port ? `<div class="td-mono" style="font-size:0.625rem;color:var(--color-text-faint);">localhost:${app.port}</div>` : ''}
    `;
    grid.appendChild(card);
  });
  container.appendChild(grid);

  // Backend services status
  const svcTitle = el('h3', { class: 'card-title', style: 'margin-bottom: var(--space-3);' }, ['Backend Services']);
  container.appendChild(svcTitle);

  const svcTable = el('div', { class: 'table-container' });
  svcTable.innerHTML = `
    <table>
      <thead><tr>
        <th>Service</th>
        <th>Port</th>
        <th>Status</th>
        <th>Purpose</th>
      </tr></thead>
      <tbody>
        ${services.map(s => {
          const statusMap = { online: 'success', degraded: 'warning', offline: 'error' };
          return `
            <tr>
              <td class="td-mono" style="font-weight:500;">${s.name}</td>
              <td class="td-mono">${s.port}</td>
              <td><span class="badge badge-${statusMap[s.status]}">${s.status === 'online' ? '●' : s.status === 'degraded' ? '◐' : '○'} ${s.status}</span></td>
              <td style="color:var(--color-text-muted);">${s.purpose}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
  container.appendChild(svcTable);

  // Service health chart
  const chartCard = el('div', { class: 'chart-card', style: 'margin-top: var(--space-5);' });
  chartCard.innerHTML = `
    <div class="chart-card-header">
      <span class="card-title">Service Health Distribution</span>
    </div>
    <div class="chart-wrap" style="height:200px;max-width:250px;margin:0 auto;">
      <canvas id="service-health-chart"></canvas>
    </div>
  `;
  container.appendChild(chartCard);

  requestAnimationFrame(() => {
    const canvas = document.getElementById('service-health-chart');
    if (canvas) {
      const online = services.filter(s => s.status === 'online').length;
      const degraded = services.filter(s => s.status === 'degraded').length;
      const offline = services.filter(s => s.status === 'offline').length;
      chartInstances.push(createDoughnutChart(
        canvas,
        ['Online', 'Degraded', 'Offline'],
        [online, degraded, offline],
        [CHART_COLORS.success, CHART_COLORS.warning, CHART_COLORS.error],
        { showLegend: true }
      ));
    }
  });
}
