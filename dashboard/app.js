// app.js — Main app, router, sidebar, header
import { renderDAGView, renderLoopsView, renderXPView, renderDFAOView, renderGovernanceView, renderReputationView, renderTemporalView, renderEcosystemView } from './views.js';

// ================================================
// ROUTE MAP
// ================================================
const routes = {
  dag:        { label: 'DAG Explorer',     icon: 'git-branch',     render: renderDAGView,        section: 'Substrate' },
  loops:      { label: 'Loop Lifecycle',   icon: 'refresh-cw',     render: renderLoopsView,      section: 'Substrate' },
  xp:        { label: 'XP & Tokens',      icon: 'zap',            render: renderXPView,         section: 'Economy' },
  dfao:       { label: 'DFAO Registry',    icon: 'network',        render: renderDFAOView,       section: 'Organization' },
  governance: { label: 'Governance',       icon: 'vote',           render: renderGovernanceView, section: 'Organization' },
  reputation: { label: 'Reputation',       icon: 'shield',         render: renderReputationView, section: 'Identity' },
  temporal:   { label: 'Temporal',         icon: 'clock',          render: renderTemporalView,   section: 'System' },
  ecosystem:  { label: 'Ecosystem',        icon: 'layout-grid',    render: renderEcosystemView,  section: 'System' },
};

const iconMap = {
  'git-branch': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>',
  'refresh-cw': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
  'zap': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
  'network': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="16" y="16" width="6" height="6" rx="1"></rect><rect x="2" y="16" width="6" height="6" rx="1"></rect><rect x="9" y="2" width="6" height="6" rx="1"></rect><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"></path><path d="M12 12V8"></path></svg>',
  'vote': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 17H4V5l8 6 8-6z"></path><path d="M4 21h16"></path></svg>',
  'shield': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
  'clock': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
  'layout-grid': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>',
  'menu': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line>',
  'bell': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>',
  'sun': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
  'moon': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
};

// ================================================
// STATE
// ================================================
let currentRoute = 'dag';
let theme = 'dark'; // default dark
let sidebarOpen = false;

// ================================================
// INIT
// ================================================
export function initApp() {
  // Set theme
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  theme = prefersDark ? 'dark' : 'dark'; // always default dark per spec
  document.documentElement.setAttribute('data-theme', theme);

  buildSidebar();
  buildHeader();

  // Read initial route from hash
  const hash = window.location.hash.replace('#', '');
  if (routes[hash]) currentRoute = hash;
  navigate(currentRoute);

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    if (routes[hash] && hash !== currentRoute) {
      navigate(hash);
    }
  });
}

// ================================================
// SIDEBAR
// ================================================
function buildSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  // Logo
  const logoHTML = `
    <div class="sidebar-header">
      <div class="sidebar-logo">
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="8" fill="var(--color-primary)"/>
          <path d="M8 16L16 8L24 16L16 24Z" fill="var(--color-bg)" opacity="0.9"/>
          <circle cx="16" cy="16" r="4" fill="var(--color-gold)"/>
        </svg>
        <div>
          <div class="sidebar-logo-text">Extropy XP</div>
          <div class="sidebar-logo-sub">Engine v0.9</div>
        </div>
      </div>
    </div>
  `;

  // Nav items grouped by section
  const sections = {};
  Object.entries(routes).forEach(([key, route]) => {
    if (!sections[route.section]) sections[route.section] = [];
    sections[route.section].push({ key, ...route });
  });

  let navHTML = '<nav class="sidebar-nav">';
  Object.entries(sections).forEach(([sectionName, items]) => {
    navHTML += `<div class="nav-section-label">${sectionName}</div>`;
    items.forEach(item => {
      navHTML += `
        <button class="nav-item ${item.key === currentRoute ? 'active' : ''}" data-route="${item.key}" aria-label="${item.label}">
          ${iconMap[item.icon] || ''}
          <span>${item.label}</span>
        </button>
      `;
    });
  });
  navHTML += '</nav>';

  // Footer
  const footerHTML = `
    <div class="sidebar-footer">
      <div class="sidebar-footer-text">12 microservices<br>dag-substrate:4008</div>
    </div>
  `;

  sidebar.innerHTML = logoHTML + navHTML + footerHTML;

  // Bind nav clicks
  sidebar.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const route = btn.getAttribute('data-route');
      if (route) {
        navigate(route);
        closeMobileSidebar();
      }
    });
  });
}

function updateSidebarActive() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-route') === currentRoute);
  });
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-overlay');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (overlay) overlay.classList.remove('visible');
  sidebarOpen = false;
}

// ================================================
// HEADER
// ================================================
function buildHeader() {
  const header = document.getElementById('header');
  if (!header) return;

  header.innerHTML = `
    <div class="header-left">
      <button class="header-hamburger" id="hamburger-btn" aria-label="Toggle sidebar">
        ${iconMap['menu']}
      </button>
      <span class="header-title" id="header-title">DAG Explorer</span>
    </div>
    <div class="header-right">
      <button class="xp-balance" onclick="window.location.hash='xp'" aria-label="View XP balance">
        <span class="xp-balance-icon">⚡</span>
        <span class="xp-balance-value">42,847 XP</span>
      </button>
      <button class="header-icon-btn" aria-label="Notifications">
        ${iconMap['bell']}
        <span class="notification-dot"></span>
      </button>
      <button class="header-icon-btn" id="theme-toggle-btn" aria-label="Toggle theme">
        ${theme === 'dark' ? iconMap['sun'] : iconMap['moon']}
      </button>
      <div class="header-avatar">XP</div>
    </div>
  `;

  // Hamburger
  document.getElementById('hamburger-btn')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-overlay');
    sidebarOpen = !sidebarOpen;
    if (sidebarOpen) {
      sidebar?.classList.add('mobile-open');
      overlay?.classList.add('visible');
    } else {
      closeMobileSidebar();
    }
  });

  // Theme toggle
  document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.innerHTML = theme === 'dark' ? iconMap['sun'] : iconMap['moon'];
  });
}

// ================================================
// ROUTER
// ================================================
function navigate(route) {
  if (!routes[route]) return;
  currentRoute = route;
  window.location.hash = route;

  // Update header title
  const titleEl = document.getElementById('header-title');
  if (titleEl) titleEl.textContent = routes[route].label;

  // Update sidebar
  updateSidebarActive();

  // Render view
  const main = document.getElementById('main-content');
  if (main) {
    // Fade transition
    main.style.opacity = '0';
    setTimeout(() => {
      routes[route].render(main);
      main.style.opacity = '1';
      main.scrollTop = 0;
    }, 120);
  }
}
