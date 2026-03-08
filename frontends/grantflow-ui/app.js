/* ============================================
   GrantFlow — Grant Discovery & Management App
   Extropy Engine — XP-based Grant Tracking
   ============================================ */

(function () {
  'use strict';

  // ─── Safe Storage Wrapper ───
  var safeStorage = (function () {
    var mem = {};
    var store = null;
    try {
      store = window.localStorage;
      store.setItem('__gf_test', '1');
      store.removeItem('__gf_test');
    } catch (_e) {
      store = null;
    }
    return {
      getItem: function (k) { return store ? store.getItem(k) : (mem[k] || null); },
      setItem: function (k, v) { if (store) { store.setItem(k, v); } else { mem[k] = String(v); } },
      removeItem: function (k) { if (store) { store.removeItem(k); } else { delete mem[k]; } }
    };
  })();

  // ─── Constants ───
  var STORAGE_PREFIX = 'grantflow_';
  var GRANTS_API = 'https://www.grants.gov/grantsws/rest/opportunities/search';

  // ─── State ───
  var state = {
    totalXP: parseInt(safeStorage.getItem(STORAGE_PREFIX + 'xp') || '0', 10),
    pipeline: loadJSON(STORAGE_PREFIX + 'pipeline') || [],
    savedGrants: loadJSON(STORAGE_PREFIX + 'saved') || [],
    proposals: loadJSON(STORAGE_PREFIX + 'proposals') || getDefaultProposals(),
    activity: loadJSON(STORAGE_PREFIX + 'activity') || [],
    searchResults: [],
    currentEditor: null
  };

  // ─── Helpers ───
  function loadJSON(key) {
    try { return JSON.parse(safeStorage.getItem(key)); } catch (_e) { return null; }
  }

  function saveJSON(key, val) {
    safeStorage.setItem(key, JSON.stringify(val));
  }

  function persistState() {
    safeStorage.setItem(STORAGE_PREFIX + 'xp', String(state.totalXP));
    saveJSON(STORAGE_PREFIX + 'pipeline', state.pipeline);
    saveJSON(STORAGE_PREFIX + 'saved', state.savedGrants);
    saveJSON(STORAGE_PREFIX + 'proposals', state.proposals);
    saveJSON(STORAGE_PREFIX + 'activity', state.activity);
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatTime(ts) {
    var d = new Date(ts);
    var now = new Date();
    var diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function daysUntil(dateStr) {
    if (!dateStr) return 999;
    var parts = dateStr.split('/');
    var d;
    if (parts.length === 3) {
      d = new Date(parts[2], parseInt(parts[0], 10) - 1, parts[1]);
    } else {
      d = new Date(dateStr);
    }
    if (isNaN(d.getTime())) return 999;
    return Math.ceil((d - new Date()) / 86400000);
  }

  function deadlineClass(days) {
    if (days < 0) return 'deadline-urgent';
    if (days < 7) return 'deadline-urgent';
    if (days < 30) return 'deadline-soon';
    return 'deadline-ok';
  }

  function deadlineIndicatorClass(days) {
    if (days < 7) return 'urgent';
    if (days < 30) return 'soon';
    return 'normal';
  }

  function randomId() {
    return Math.random().toString(36).slice(2, 10);
  }

  // ─── XP System ───
  function awardXP(amount, message) {
    state.totalXP += amount;
    updateXPDisplay();
    showToast('<span class="toast-xp">+' + amount + ' XP</span> ' + escapeHtml(message), 'xp');

    var xpBadge = document.getElementById('xpBadge');
    if (xpBadge) {
      xpBadge.classList.add('xp-pop');
      setTimeout(function () { xpBadge.classList.remove('xp-pop'); }, 700);
    }

    persistState();
  }

  function updateXPDisplay() {
    var formatted = state.totalXP.toLocaleString() + ' XP';
    var el = document.getElementById('xpCount');
    var elMobile = document.getElementById('xpCountMobile');
    if (el) el.textContent = formatted;
    if (elMobile) elMobile.textContent = formatted;
  }

  // ─── Toast ───
  function showToast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toastContainer');
    var toast = document.createElement('div');
    toast.className = 'toast' + (type === 'xp' ? ' xp-toast' : '');
    toast.innerHTML = message;
    container.appendChild(toast);
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4000);
  }

  // ─── Activity Log ───
  function addActivity(color, text) {
    state.activity.unshift({ color: color, text: text, time: new Date().toISOString() });
    if (state.activity.length > 30) state.activity.length = 30;
    persistState();
    renderActivity();
  }

  function renderActivity() {
    var el = document.getElementById('activityList');
    if (!el) return;
    if (state.activity.length === 0) {
      el.innerHTML = '<div class="activity-empty">No recent activity. Discover grants to get started.</div>';
      return;
    }
    el.innerHTML = state.activity.slice(0, 12).map(function (a) {
      return '<div class="activity-item">' +
        '<div class="activity-dot ' + a.color + '"></div>' +
        '<span class="activity-text">' + escapeHtml(a.text) + '</span>' +
        '<span class="activity-time">' + formatTime(a.time) + '</span>' +
        '</div>';
    }).join('');
  }

  // ─── Animated Counter ───
  function animateNumber(el, target, duration) {
    if (!el) return;
    duration = duration || 800;
    var start = parseInt(el.textContent.replace(/[^0-9.-]/g, ''), 10) || 0;
    var startTime = null;
    target = Math.round(target);

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      var ease = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(start + (target - start) * ease).toLocaleString();
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ─── Mock Grant Data ───
  function getMockGrants() {
    return [
      {
        id: 'mock-nsf-001',
        title: 'Foundations of Entropy-Aware Distributed Computing Systems',
        agency: 'NSF',
        agencyCode: 'NSF',
        number: 'NSF-CISE-2026-001',
        openDate: '01/15/2026',
        closeDate: '06/15/2026',
        oppStatus: 'posted',
        awardCeiling: 500000,
        description: 'Research in novel entropy-based algorithms for distributed IoT systems, focusing on thermodynamic optimization of decentralized networks and information-theoretic approaches to self-organizing systems.',
        matchScore: 95,
        category: 'Science & Technology'
      },
      {
        id: 'mock-doe-001',
        title: 'Advanced Energy Systems Optimization via Information Theory',
        agency: 'DOE ARPA-E',
        agencyCode: 'DOE',
        number: 'DE-FOA-0003201',
        openDate: '02/01/2026',
        closeDate: '05/30/2026',
        oppStatus: 'posted',
        awardCeiling: 1500000,
        description: 'Developing next-generation energy management systems that leverage information-theoretic principles for smart grid optimization, including entropy-based demand response and autonomous energy trading protocols.',
        matchScore: 88,
        category: 'Energy'
      },
      {
        id: 'mock-darpa-001',
        title: 'Autonomous Information Processing for Resilient IoT Networks',
        agency: 'DARPA',
        agencyCode: 'DOD',
        number: 'HR001126S0001',
        openDate: '12/01/2025',
        closeDate: '04/15/2026',
        oppStatus: 'posted',
        awardCeiling: 2000000,
        description: 'Creating self-healing IoT architectures using entropy metrics for network resilience, with applications in defense infrastructure monitoring and autonomous threat detection.',
        matchScore: 82,
        category: 'Information Systems'
      },
      {
        id: 'mock-nih-001',
        title: 'Health Informatics: Entropy-Based Anomaly Detection in Patient Monitoring',
        agency: 'NIH',
        agencyCode: 'HHS',
        number: 'PAR-26-102',
        openDate: '01/10/2026',
        closeDate: '07/10/2026',
        oppStatus: 'posted',
        awardCeiling: 750000,
        description: 'Applying information entropy methods to real-time patient monitoring systems for early detection of health anomalies, sepsis prediction, and ICU optimization using IoT sensor networks.',
        matchScore: 72,
        category: 'Health'
      },
      {
        id: 'mock-sloan-001',
        title: 'Sloan Research Fellowship — Information Science & Complex Systems',
        agency: 'Sloan Foundation',
        agencyCode: 'PRIV',
        number: 'SRF-2026-IS',
        openDate: '03/01/2026',
        closeDate: '09/15/2026',
        oppStatus: 'posted',
        awardCeiling: 75000,
        description: 'Fellowship supporting early-career researchers doing fundamental work in information science, complex adaptive systems, and entropy-driven computation paradigms.',
        matchScore: 90,
        category: 'Science & Technology'
      },
      {
        id: 'mock-simons-001',
        title: 'Simons Collaboration on the Mathematical Theory of Emergence',
        agency: 'Simons Foundation',
        agencyCode: 'PRIV',
        number: 'SCG-2026-EMRG',
        openDate: '02/15/2026',
        closeDate: '08/01/2026',
        oppStatus: 'posted',
        awardCeiling: 350000,
        description: 'Supporting collaborative research into mathematical foundations of emergent phenomena, self-organization in complex systems, and the role of information entropy in phase transitions.',
        matchScore: 85,
        category: 'Science & Technology'
      },
      {
        id: 'mock-nsf-002',
        title: 'Cyber-Physical Systems: Decentralized Governance Protocols',
        agency: 'NSF',
        agencyCode: 'NSF',
        number: 'NSF-CPS-2026-014',
        openDate: '03/15/2026',
        closeDate: '09/30/2026',
        oppStatus: 'posted',
        awardCeiling: 600000,
        description: 'Research on decentralized governance models for cyber-physical systems integrating blockchain, entropy verification, and multi-agent consensus in IoT environments.',
        matchScore: 91,
        category: 'Information Systems'
      },
      {
        id: 'mock-macarthur-001',
        title: 'MacArthur Foundation: Technology for the Public Good',
        agency: 'MacArthur Foundation',
        agencyCode: 'PRIV',
        number: 'MAC-TPG-2026',
        openDate: '04/01/2026',
        closeDate: '10/01/2026',
        oppStatus: 'forecasted',
        awardCeiling: 250000,
        description: 'Grants supporting innovative technology projects that serve the public interest, with emphasis on open-source tools, decentralized systems, and equitable access to information technology.',
        matchScore: 78,
        category: 'Science & Technology'
      }
    ];
  }

  // ─── Default Pipeline Items ───
  function getDefaultPipeline() {
    return [
      {
        id: 'pipe-001',
        title: 'Foundations of Entropy-Aware Distributed Computing',
        agency: 'NSF',
        deadline: '06/15/2026',
        stage: 'drafting',
        xpEarned: 125,
        grantId: 'mock-nsf-001'
      },
      {
        id: 'pipe-002',
        title: 'Advanced Energy Systems via Information Theory',
        agency: 'DOE ARPA-E',
        deadline: '05/30/2026',
        stage: 'researching',
        xpEarned: 50,
        grantId: 'mock-doe-001'
      },
      {
        id: 'pipe-003',
        title: 'Autonomous Info Processing for Resilient IoT',
        agency: 'DARPA',
        deadline: '04/15/2026',
        stage: 'review',
        xpEarned: 200,
        grantId: 'mock-darpa-001'
      },
      {
        id: 'pipe-004',
        title: 'Entropy-Based Anomaly Detection in Health',
        agency: 'NIH',
        deadline: '07/10/2026',
        stage: 'discovered',
        xpEarned: 50,
        grantId: 'mock-nih-001'
      },
      {
        id: 'pipe-005',
        title: 'Sloan Fellowship — Information Science',
        agency: 'Sloan Foundation',
        deadline: '09/15/2026',
        stage: 'drafting',
        xpEarned: 100,
        grantId: 'mock-sloan-001'
      },
      {
        id: 'pipe-006',
        title: 'Decentralized Governance Protocols',
        agency: 'NSF',
        deadline: '09/30/2026',
        stage: 'discovered',
        xpEarned: 50,
        grantId: 'mock-nsf-002'
      },
      {
        id: 'pipe-007',
        title: 'Previous: Smart Grid Optimization Study',
        agency: 'DOE',
        deadline: '01/15/2026',
        stage: 'awarded',
        xpEarned: 1000,
        grantId: 'mock-awarded-001',
        awardAmount: 450000
      },
      {
        id: 'pipe-008',
        title: 'Previous: IoT Security Framework',
        agency: 'DARPA',
        deadline: '11/01/2025',
        stage: 'submitted',
        xpEarned: 250,
        grantId: 'mock-submitted-001'
      }
    ];
  }

  // ─── Default Proposals ───
  function getDefaultProposals() {
    return [
      {
        id: 'prop-exec',
        name: 'Executive Summary',
        description: 'High-level overview of the project, its goals, and expected outcomes. Must capture reviewer attention in the first paragraph.',
        template: 'The Extropy Engine project proposes to develop a novel entropy-aware distributed computing platform that leverages thermodynamic principles for IoT network optimization. Our approach uniquely combines information theory with practical systems engineering to create self-organizing, self-healing networks that continuously reduce entropy while maintaining operational resilience.\n\nKey innovation areas include:\n- Entropy-based consensus mechanisms for decentralized IoT governance\n- Thermodynamic optimization algorithms for energy-efficient computing\n- Real-time entropy metrics for network health monitoring\n- XP-based incentive system for contributor alignment',
        content: '',
        completed: false,
        xp: 75
      },
      {
        id: 'prop-narrative',
        name: 'Project Narrative',
        description: 'Detailed description of the research plan, methodology, timeline, and expected deliverables.',
        template: '1. BACKGROUND AND SIGNIFICANCE\n\nThe challenge of managing entropy in distributed systems is fundamental to modern computing infrastructure. As IoT networks scale to billions of devices, traditional centralized management approaches fail to maintain system coherence...\n\n2. RESEARCH DESIGN AND METHODS\n\nOur approach integrates three core methodologies:\n- Information-theoretic analysis of network state\n- Thermodynamic modeling of computational processes\n- Game-theoretic incentive design for participant alignment\n\n3. TIMELINE\n\nYear 1: Foundation development and entropy measurement framework\nYear 2: Distributed protocol design and testing\nYear 3: Field deployment and validation',
        content: '',
        completed: false,
        xp: 75
      },
      {
        id: 'prop-budget',
        name: 'Budget Justification',
        description: 'Detailed breakdown and justification of all requested funds, including personnel, equipment, and indirect costs.',
        template: 'BUDGET JUSTIFICATION\n\nA. SENIOR PERSONNEL\n- PI (Randall): 2 months summer salary — $XX,XXX\n  Responsible for overall project direction, entropy algorithm design\n\nB. OTHER PERSONNEL\n- Graduate Research Assistant (2): $XX,XXX each\n  IoT system development and testing\n- Postdoctoral Researcher (1): $XX,XXX\n  Mathematical modeling and analysis\n\nC. EQUIPMENT\n- IoT sensor network testbed: $XX,XXX\n- High-performance computing cluster access: $XX,XXX\n\nD. TRAVEL\n- Conference presentations (2 per year): $X,XXX\n\nE. OTHER DIRECT COSTS\n- Cloud computing and data storage: $X,XXX/year\n- Open-source software licensing: $X,XXX',
        content: '',
        completed: false,
        xp: 75
      },
      {
        id: 'prop-eval',
        name: 'Evaluation Plan',
        description: 'Metrics, milestones, and methods for assessing project progress and success.',
        template: 'EVALUATION FRAMEWORK\n\n1. QUANTITATIVE METRICS\n- Network entropy reduction: Target 40% decrease in system entropy\n- Energy efficiency: 25% improvement over baseline\n- Latency: Sub-100ms consensus for 1000-node networks\n- Uptime: 99.9% availability with autonomous recovery\n\n2. QUALITATIVE MEASURES\n- Code quality and documentation standards\n- Community adoption metrics\n- Peer review of published research\n\n3. MILESTONES\nQ1: Entropy measurement framework validated\nQ2: Prototype distributed protocol operational\nQ3: 100-device testbed deployment\nQ4: Performance benchmarks published',
        content: '',
        completed: false,
        xp: 75
      },
      {
        id: 'prop-org',
        name: 'Organizational Capacity',
        description: 'Description of the organization\'s ability to carry out the proposed work, including facilities and expertise.',
        template: 'ORGANIZATIONAL CAPACITY\n\nThe Extropy Engine project operates at the intersection of academic research and open-source innovation. Our team brings together expertise in:\n\n- Information theory and entropy (PI: 10+ years)\n- IoT systems engineering (5+ production deployments)\n- Decentralized protocols (3 published peer-reviewed papers)\n- Smart grid and energy systems (DOE-funded prior work)\n\nFACILITIES\n- Dedicated IoT testbed with 500+ sensors\n- High-performance computing cluster (128 cores)\n- Secure data center with 99.99% uptime\n\nPRIOR SUPPORT\n- DOE ARPA-E: Smart Grid Optimization ($450K, 2024-2025)\n- NSF CISE: Entropy Metrics in CPS ($350K, 2023-2024)',
        content: '',
        completed: false,
        xp: 75
      },
      {
        id: 'prop-letters',
        name: 'Letters of Support',
        description: 'Template for requesting and organizing letters of support from collaborators and stakeholders.',
        template: 'LETTERS OF SUPPORT — TRACKING\n\n1. Dr. [Collaborator Name], [University]\n   Status: Requested\n   Focus: Entropy measurement methodology validation\n\n2. [Industry Partner], CTO\n   Status: Confirmed\n   Focus: IoT deployment infrastructure and testing\n\n3. [Government Agency Contact]\n   Status: Pending\n   Focus: Smart city integration opportunities\n\n4. [Open Source Community Leader]\n   Status: Confirmed\n   Focus: Community adoption and code review\n\nTEMPLATE FOR REQUEST:\n\nDear [Name],\n\nI am writing to request a letter of support for our proposal to [Agency] titled "[Grant Title]". Your expertise in [area] would strengthen our proposal, particularly regarding [specific aspect]...',
        content: '',
        completed: false,
        xp: 75
      }
    ];
  }

  // ─── Initialize Pipeline ───
  function initPipeline() {
    if (state.pipeline.length === 0) {
      state.pipeline = getDefaultPipeline();
      persistState();
    }
  }

  // ─── Grants.gov API ───
  async function searchGrantsGov(keyword) {
    try {
      var response = await fetch(GRANTS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: keyword || '',
          oppStatuses: 'forecasted|posted',
          rows: 25
        })
      });
      var data = await response.json();
      if (data && data.oppHits) {
        return data.oppHits.map(function (hit) {
          return {
            id: 'gov-' + hit.id,
            title: hit.title || 'Untitled',
            agency: hit.agency || 'Unknown Agency',
            agencyCode: hit.agencyCode || '',
            number: hit.number || '',
            openDate: hit.openDate || '',
            closeDate: hit.closeDate || '',
            oppStatus: hit.oppStatus || 'posted',
            awardCeiling: null,
            description: 'Agency: ' + (hit.agency || 'N/A') + ' | Opportunity Number: ' + (hit.number || 'N/A') + ' | CFDA: ' + (hit.cfdaList ? hit.cfdaList.join(', ') : 'N/A'),
            matchScore: Math.floor(Math.random() * 30) + 50,
            category: 'General',
            source: 'grants.gov'
          };
        });
      }
      return null;
    } catch (_err) {
      return null;
    }
  }

  async function performSearch() {
    var keyword = document.getElementById('grantSearch').value.trim();
    var resultsEl = document.getElementById('grantResults');
    var countEl = document.getElementById('searchResultCount');

    resultsEl.innerHTML = '<div class="search-loading"><div class="spinner"></div>Searching Grants.gov...</div>';

    // Try real API first
    var apiResults = await searchGrantsGov(keyword);

    // Combine with mock data
    var mockGrants = getMockGrants();
    var allResults;

    if (apiResults && apiResults.length > 0) {
      // Put mock data first (higher match scores), then API results
      allResults = mockGrants.concat(apiResults);
    } else {
      allResults = mockGrants;
      if (keyword) {
        showToast('Grants.gov API unavailable — showing curated results', 'info');
      }
    }

    // Filter by keyword
    if (keyword) {
      var kw = keyword.toLowerCase();
      allResults = allResults.filter(function (g) {
        return g.title.toLowerCase().includes(kw) ||
          g.agency.toLowerCase().includes(kw) ||
          g.description.toLowerCase().includes(kw) ||
          (g.number && g.number.toLowerCase().includes(kw));
      });
    }

    // Apply filters
    var agencyFilter = document.getElementById('filterAgency').value;
    var statusFilter = document.getElementById('filterStatus').value;

    if (agencyFilter) {
      allResults = allResults.filter(function (g) {
        return g.agencyCode && g.agencyCode.toUpperCase().includes(agencyFilter.toUpperCase());
      });
    }

    if (statusFilter) {
      allResults = allResults.filter(function (g) {
        return g.oppStatus === statusFilter;
      });
    }

    // Sort by match score
    allResults.sort(function (a, b) { return (b.matchScore || 0) - (a.matchScore || 0); });

    state.searchResults = allResults;
    countEl.textContent = allResults.length + ' results';
    renderSearchResults(allResults);
  }

  function renderSearchResults(results) {
    var el = document.getElementById('grantResults');
    if (results.length === 0) {
      el.innerHTML = '<div class="empty-state">No grants found matching your criteria. Try different keywords.</div>';
      return;
    }

    el.innerHTML = results.map(function (g) {
      var days = daysUntil(g.closeDate);
      var daysText = g.closeDate ? (days < 0 ? 'Closed' : days + ' days left') : 'Open';
      var isSaved = state.savedGrants.some(function (s) { return s.id === g.id; });
      var inPipeline = state.pipeline.some(function (p) { return p.grantId === g.id; });

      return '<div class="grant-card">' +
        '<div class="grant-card-top">' +
        '<div class="grant-card-title">' + escapeHtml(g.title) + '</div>' +
        (g.matchScore ? '<span class="grant-card-match">' + g.matchScore + '% match</span>' : '') +
        '</div>' +
        '<div class="grant-card-meta">' +
        '<span class="grant-card-meta-item"><span>Agency:</span>' + escapeHtml(g.agency) + '</span>' +
        (g.number ? '<span class="grant-card-meta-item"><span>No:</span>' + escapeHtml(g.number) + '</span>' : '') +
        '<span class="grant-card-meta-item ' + deadlineClass(days) + '"><span>Deadline:</span>' + (g.closeDate || 'Open') + ' (' + daysText + ')</span>' +
        (g.awardCeiling ? '<span class="grant-card-meta-item"><span>Award:</span>$' + g.awardCeiling.toLocaleString() + '</span>' : '') +
        '</div>' +
        '<div class="grant-card-desc">' + escapeHtml(g.description) + '</div>' +
        '<div class="grant-card-actions">' +
        (isSaved ? '<span class="saved-badge">Saved</span>' : '<button class="btn-accent btn-sm" data-action="save" data-grant-id="' + g.id + '">Save</button>') +
        (inPipeline ? '<span class="status-badge discovered">In Pipeline</span>' : '<button class="btn-primary btn-sm" data-action="apply" data-grant-id="' + g.id + '">Quick Apply</button>') +
        '</div>' +
        '</div>';
    }).join('');
  }

  // ─── Pipeline / Kanban ───
  var KANBAN_STAGES = [
    { id: 'discovered', label: 'Discovered' },
    { id: 'researching', label: 'Researching' },
    { id: 'drafting', label: 'Drafting' },
    { id: 'review', label: 'Review' },
    { id: 'submitted', label: 'Submitted' },
    { id: 'awarded', label: 'Awarded' }
  ];

  function renderKanban() {
    var board = document.getElementById('kanbanBoard');
    if (!board) return;

    board.innerHTML = KANBAN_STAGES.map(function (stage) {
      var cards = state.pipeline.filter(function (p) { return p.stage === stage.id; });
      var cardsHtml = cards.map(function (card) {
        var days = daysUntil(card.deadline);
        var daysText = card.deadline ? (days < 0 ? 'Overdue' : days + 'd left') : 'No deadline';
        var stageIndex = KANBAN_STAGES.findIndex(function (s) { return s.id === card.stage; });
        var canMoveLeft = stageIndex > 0;
        var canMoveRight = stageIndex < KANBAN_STAGES.length - 1;

        return '<div class="kanban-card" data-card-id="' + card.id + '">' +
          '<div class="kanban-card-title">' + escapeHtml(card.title) + '</div>' +
          '<div class="kanban-card-agency">' + escapeHtml(card.agency) + '</div>' +
          '<div class="kanban-card-footer">' +
          '<span class="kanban-card-deadline ' + deadlineClass(days) + '">' + daysText + '</span>' +
          '<span class="kanban-card-xp">+' + card.xpEarned + ' XP</span>' +
          '</div>' +
          '<div class="kanban-card-move">' +
          (canMoveLeft ? '<button data-action="move-left" data-card-id="' + card.id + '">&larr;</button>' : '') +
          (canMoveRight ? '<button data-action="move-right" data-card-id="' + card.id + '">&rarr;</button>' : '') +
          '</div>' +
          '</div>';
      }).join('');

      return '<div class="kanban-column">' +
        '<div class="kanban-column-header">' +
        '<span class="kanban-column-title">' + stage.label + '</span>' +
        '<span class="kanban-column-count">' + cards.length + '</span>' +
        '</div>' +
        '<div class="kanban-cards">' +
        (cardsHtml || '<div class="activity-empty" style="padding:8px;font-size:11px;">No items</div>') +
        '</div>' +
        '</div>';
    }).join('');
  }

  function moveCard(cardId, direction) {
    var card = state.pipeline.find(function (p) { return p.id === cardId; });
    if (!card) return;

    var currentIdx = KANBAN_STAGES.findIndex(function (s) { return s.id === card.stage; });
    var newIdx = direction === 'right' ? currentIdx + 1 : currentIdx - 1;

    if (newIdx < 0 || newIdx >= KANBAN_STAGES.length) return;

    var oldStage = card.stage;
    card.stage = KANBAN_STAGES[newIdx].id;

    // Award XP for stage transitions
    if (direction === 'right') {
      var xpMap = {
        researching: { amount: 50, msg: 'Grant researched — moving to research phase' },
        drafting: { amount: 75, msg: 'Research complete — drafting proposal' },
        review: { amount: 75, msg: 'Draft complete — entering review' },
        submitted: { amount: 250, msg: 'Application Submitted!' },
        awarded: { amount: 1000, msg: 'Grant Awarded! Congratulations!' }
      };

      var reward = xpMap[card.stage];
      if (reward) {
        card.xpEarned += reward.amount;
        awardXP(reward.amount, reward.msg);
        addActivity(card.stage === 'awarded' ? 'green' : 'blue', reward.msg + ' — ' + card.title);
      }
    }

    persistState();
    renderKanban();
    renderMiniPipeline();
    renderDashboardKPIs();
  }

  // ─── Mini Pipeline (Dashboard) ───
  function renderMiniPipeline() {
    var el = document.getElementById('miniPipeline');
    if (!el) return;

    var stageCounts = {};
    KANBAN_STAGES.forEach(function (s) { stageCounts[s.id] = 0; });
    state.pipeline.forEach(function (p) {
      if (stageCounts[p.stage] !== undefined) stageCounts[p.stage]++;
    });

    el.innerHTML = '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      KANBAN_STAGES.map(function (s) {
        return '<div style="flex:1;min-width:80px;text-align:center;padding:10px 6px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-md);">' +
          '<div style="font-family:var(--font-mono);font-size:20px;font-weight:700;color:var(--text-primary);">' + stageCounts[s.id] + '</div>' +
          '<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">' + s.label + '</div>' +
          '</div>';
      }).join('') +
      '</div>';
  }

  // ─── Deadlines ───
  function renderDeadlines() {
    var el = document.getElementById('deadlinesList');
    if (!el) return;

    var active = state.pipeline.filter(function (p) {
      return p.deadline && p.stage !== 'awarded' && p.stage !== 'declined';
    });

    active.sort(function (a, b) { return daysUntil(a.deadline) - daysUntil(b.deadline); });

    if (active.length === 0) {
      el.innerHTML = '<div class="activity-empty">No upcoming deadlines</div>';
      return;
    }

    el.innerHTML = active.slice(0, 6).map(function (item) {
      var days = daysUntil(item.deadline);
      var daysText = days < 0 ? 'Overdue' : days + ' days';
      var indicatorClass = deadlineIndicatorClass(days);

      return '<div class="deadline-item">' +
        '<div class="deadline-indicator ' + indicatorClass + '"></div>' +
        '<div class="deadline-info">' +
        '<div class="deadline-name">' + escapeHtml(item.title) + '</div>' +
        '<div class="deadline-agency">' + escapeHtml(item.agency) + '</div>' +
        '</div>' +
        '<div class="deadline-date ' + deadlineClass(days) + '">' + daysText + '</div>' +
        '</div>';
    }).join('');
  }

  // ─── Dashboard KPIs ───
  function renderDashboardKPIs() {
    animateNumber(document.getElementById('kpiTotalXP'), state.totalXP);

    var submitted = state.pipeline.filter(function (p) {
      return p.stage === 'submitted' || p.stage === 'awarded' || p.stage === 'declined';
    });
    var awarded = state.pipeline.filter(function (p) { return p.stage === 'awarded'; });
    var winRate = submitted.length > 0 ? Math.round((awarded.length / submitted.length) * 100) : 0;

    animateNumber(document.getElementById('kpiTotalApplied'), submitted.length);
    animateNumber(document.getElementById('kpiWinRate'), winRate);

    var completedProposals = state.proposals.filter(function (p) { return p.completed; }).length;
    animateNumber(document.getElementById('kpiProposals'), completedProposals);

    // Sidebar count
    var sidebarCount = document.getElementById('sidebarGrantCount');
    if (sidebarCount) sidebarCount.textContent = state.pipeline.length + ' grants tracked';

    // Proposal XP badge
    var proposalXP = document.getElementById('proposalXPBadge');
    if (proposalXP) {
      var pxp = state.proposals.reduce(function (sum, p) { return sum + (p.completed ? p.xp : 0); }, 0);
      proposalXP.textContent = pxp + ' XP earned';
    }
  }

  // ─── Proposals ───
  function renderProposals() {
    var el = document.getElementById('proposalSections');
    if (!el) return;

    el.innerHTML = state.proposals.map(function (p) {
      return '<div class="proposal-section-card' + (p.completed ? ' completed' : '') + '" data-proposal-id="' + p.id + '">' +
        '<div class="proposal-section-header">' +
        '<span class="proposal-section-name">' + escapeHtml(p.name) + '</span>' +
        '<span class="proposal-section-xp">+' + p.xp + ' XP</span>' +
        '</div>' +
        '<div class="proposal-section-desc">' + escapeHtml(p.description) + '</div>' +
        '<div class="proposal-section-status' + (p.completed ? ' done' : '') + '">' +
        (p.completed ? 'Completed' : 'Click to edit') +
        '</div>' +
        '</div>';
    }).join('');
  }

  function openEditor(proposalId) {
    var proposal = state.proposals.find(function (p) { return p.id === proposalId; });
    if (!proposal) return;

    state.currentEditor = proposalId;
    document.getElementById('editorTitle').textContent = proposal.name;
    document.getElementById('editorTextarea').value = proposal.content || proposal.template || '';
    document.getElementById('proposalEditorOverlay').classList.add('active');
  }

  function closeEditor() {
    document.getElementById('proposalEditorOverlay').classList.remove('active');
    state.currentEditor = null;
  }

  function saveSection() {
    if (!state.currentEditor) return;
    var proposal = state.proposals.find(function (p) { return p.id === state.currentEditor; });
    if (!proposal) return;

    var content = document.getElementById('editorTextarea').value.trim();
    proposal.content = content;

    if (content.length > 50 && !proposal.completed) {
      proposal.completed = true;
      awardXP(proposal.xp, 'Proposal Section Drafted — ' + proposal.name);
      addActivity('green', 'Completed proposal section: ' + proposal.name);
    }

    persistState();
    closeEditor();
    renderProposals();
    renderDashboardKPIs();
    showToast('Section saved — ' + proposal.name);
  }

  function generateSection() {
    if (!state.currentEditor) return;
    var proposal = state.proposals.find(function (p) { return p.id === state.currentEditor; });
    if (!proposal) return;

    // Show the template as "AI-generated" content
    var textarea = document.getElementById('editorTextarea');
    var template = proposal.template || 'AI-generated content would appear here based on your project profile and the grant requirements.';

    // Simulate typing effect
    textarea.value = '';
    var idx = 0;
    var speed = 8;

    function typeChar() {
      if (idx < template.length) {
        textarea.value += template[idx];
        idx++;
        setTimeout(typeChar, speed);
      } else {
        showToast('AI draft generated — review and customize');
      }
    }

    showToast('Generating draft with AI...');
    typeChar();
  }

  // ─── Analytics ───
  function renderAnalytics() {
    renderActivityChart();
    renderTokenDistribution();
    renderCalendar();
    renderFunnel();
    renderAnalyticsKPIs();
  }

  function renderAnalyticsKPIs() {
    var awarded = state.pipeline.filter(function (p) { return p.stage === 'awarded'; });
    var totalFunding = awarded.reduce(function (sum, p) { return sum + (p.awardAmount || 0); }, 0);
    animateNumber(document.getElementById('kpiFundingWon'), totalFunding);
    animateNumber(document.getElementById('kpiDiscovered'), state.pipeline.length);

    var submitted = state.pipeline.filter(function (p) {
      return p.stage === 'submitted' || p.stage === 'awarded';
    });
    var successRate = submitted.length > 0 ? Math.round((awarded.length / submitted.length) * 100) : 0;
    animateNumber(document.getElementById('kpiSuccessRate'), successRate);

    var active = state.pipeline.filter(function (p) {
      return p.stage !== 'awarded' && p.stage !== 'declined';
    });
    animateNumber(document.getElementById('kpiActivePipeline'), active.length);
  }

  function renderActivityChart() {
    var container = document.getElementById('activityChart');
    if (!container) return;

    // Generate mock monthly data
    var months = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb'];
    var discovered = [3, 5, 4, 6, 8, 7];
    var applied = [1, 2, 1, 3, 2, 4];

    var width = container.clientWidth || 500;
    var height = container.clientHeight || 220;
    var padL = 40, padR = 16, padT = 20, padB = 40;
    var chartW = width - padL - padR;
    var chartH = height - padT - padB;

    var maxVal = Math.max.apply(null, discovered) + 2;
    var barWidth = chartW / months.length * 0.35;
    var groupWidth = chartW / months.length;

    var bars = months.map(function (_, i) {
      var x = padL + i * groupWidth + groupWidth * 0.15;
      var h1 = (discovered[i] / maxVal) * chartH;
      var h2 = (applied[i] / maxVal) * chartH;
      var y1 = padT + chartH - h1;
      var y2 = padT + chartH - h2;

      return '<rect class="chart-bar" x="' + x + '" y="' + y1 + '" width="' + barWidth + '" height="' + h1 + '" rx="2" opacity="0.5"/>' +
        '<rect class="chart-bar" x="' + (x + barWidth + 3) + '" y="' + y2 + '" width="' + barWidth + '" height="' + h2 + '" rx="2" opacity="1"/>';
    }).join('');

    var xLabels = months.map(function (m, i) {
      var x = padL + i * groupWidth + groupWidth * 0.5;
      return '<text class="chart-label" x="' + x + '" y="' + (height - 8) + '" text-anchor="middle">' + m + '</text>';
    }).join('');

    // Y-axis
    var gridLines = '';
    for (var g = 0; g <= 4; g++) {
      var yVal = (maxVal / 4) * g;
      var yPos = padT + chartH - (yVal / maxVal) * chartH;
      gridLines += '<line class="chart-grid-line" x1="' + padL + '" y1="' + yPos + '" x2="' + (width - padR) + '" y2="' + yPos + '"/>';
      gridLines += '<text class="chart-label" x="' + (padL - 6) + '" y="' + (yPos + 3) + '" text-anchor="end">' + Math.round(yVal) + '</text>';
    }

    // Legend
    var legend = '<rect x="' + (width - 140) + '" y="4" width="10" height="10" rx="2" fill="var(--accent)" opacity="0.5"/>' +
      '<text class="chart-label" x="' + (width - 126) + '" y="13">Discovered</text>' +
      '<rect x="' + (width - 70) + '" y="4" width="10" height="10" rx="2" fill="var(--accent)"/>' +
      '<text class="chart-label" x="' + (width - 56) + '" y="13">Applied</text>';

    container.innerHTML = '<svg class="chart-svg" viewBox="0 0 ' + width + ' ' + height + '">' +
      gridLines + bars + xLabels + legend +
      '</svg>';
  }

  function renderTokenDistribution() {
    var container = document.getElementById('tokenRadar');
    if (!container) return;

    // Token values for Randall
    var tokens = [
      { label: 'XP', value: 85, color: 'var(--accent)' },
      { label: 'CT', value: 60, color: 'var(--info)' },
      { label: 'CAT', value: 72, color: 'var(--status-settled)' },
      { label: 'IT', value: 45, color: 'var(--warning)' },
      { label: 'DT', value: 90, color: 'var(--positive)' },
      { label: 'EP', value: 55, color: 'var(--negative)' }
    ];

    var size = Math.min(container.clientWidth || 240, 240);
    var cx = size / 2;
    var cy = size / 2;
    var maxR = size / 2 - 30;
    var n = tokens.length;

    // Draw radar
    function polarToCart(angle, radius) {
      var a = (angle - 90) * Math.PI / 180;
      return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
    }

    // Grid rings
    var rings = '';
    for (var r = 1; r <= 4; r++) {
      var ringR = (maxR / 4) * r;
      var ringPoints = [];
      for (var ri = 0; ri < n; ri++) {
        var rp = polarToCart((360 / n) * ri, ringR);
        ringPoints.push(rp.x + ',' + rp.y);
      }
      rings += '<polygon points="' + ringPoints.join(' ') + '" fill="none" stroke="var(--border)" stroke-width="0.5"/>';
    }

    // Spokes
    var spokes = '';
    for (var si = 0; si < n; si++) {
      var sp = polarToCart((360 / n) * si, maxR);
      spokes += '<line x1="' + cx + '" y1="' + cy + '" x2="' + sp.x + '" y2="' + sp.y + '" stroke="var(--border)" stroke-width="0.5"/>';
    }

    // Data polygon
    var dataPoints = [];
    for (var di = 0; di < n; di++) {
      var dp = polarToCart((360 / n) * di, (tokens[di].value / 100) * maxR);
      dataPoints.push(dp.x + ',' + dp.y);
    }
    var dataPolygon = '<polygon points="' + dataPoints.join(' ') + '" fill="var(--accent)" fill-opacity="0.15" stroke="var(--accent)" stroke-width="2"/>';

    // Dots and labels
    var dots = '';
    var labels = '';
    for (var li = 0; li < n; li++) {
      var dotP = polarToCart((360 / n) * li, (tokens[li].value / 100) * maxR);
      dots += '<circle cx="' + dotP.x + '" cy="' + dotP.y + '" r="3" fill="var(--accent)"/>';

      var labelP = polarToCart((360 / n) * li, maxR + 16);
      labels += '<text x="' + labelP.x + '" y="' + (labelP.y + 3) + '" text-anchor="middle" class="chart-label" style="font-weight:600;fill:var(--text-secondary)">' + tokens[li].label + '</text>';
    }

    container.innerHTML = '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '">' +
      rings + spokes + dataPolygon + dots + labels +
      '</svg>';
  }

  function renderCalendar() {
    var container = document.getElementById('calendarGrid');
    var monthLabel = document.getElementById('calendarMonth');
    if (!container) return;

    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth();
    var monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (monthLabel) monthLabel.textContent = monthName;

    var firstDay = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var today = now.getDate();

    // Collect deadline dates
    var deadlineDates = {};
    state.pipeline.forEach(function (p) {
      if (!p.deadline) return;
      var days = daysUntil(p.deadline);
      var parts = p.deadline.split('/');
      if (parts.length === 3) {
        var dMonth = parseInt(parts[0], 10) - 1;
        var dDay = parseInt(parts[1], 10);
        var dYear = parseInt(parts[2], 10);
        if (dMonth === month && dYear === year) {
          deadlineDates[dDay] = deadlineIndicatorClass(days);
        }
      }
    });

    // Headers
    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var html = dayNames.map(function (d) {
      return '<div class="calendar-header-cell">' + d + '</div>';
    }).join('');

    // Empty cells before first day
    for (var e = 0; e < firstDay; e++) {
      html += '<div class="calendar-cell other-month"></div>';
    }

    // Day cells
    for (var d = 1; d <= daysInMonth; d++) {
      var isToday = d === today;
      var dot = deadlineDates[d] ? '<div class="calendar-dot ' + deadlineDates[d] + '"></div>' : '';
      html += '<div class="calendar-cell' + (isToday ? ' today' : '') + '">' + d + dot + '</div>';
    }

    container.innerHTML = html;
  }

  function renderFunnel() {
    var container = document.getElementById('fundingFunnel');
    if (!container) return;

    var stages = [
      { label: 'Discovered', count: 0 },
      { label: 'Researching', count: 0 },
      { label: 'Drafting', count: 0 },
      { label: 'In Review', count: 0 },
      { label: 'Submitted', count: 0 },
      { label: 'Awarded', count: 0 }
    ];

    var stageMap = { discovered: 0, researching: 1, drafting: 2, review: 3, submitted: 4, awarded: 5 };
    state.pipeline.forEach(function (p) {
      var idx = stageMap[p.stage];
      if (idx !== undefined) stages[idx].count++;
    });

    var maxWidth = 100;
    container.innerHTML = stages.map(function (s, i) {
      var widthPct = maxWidth - (i * 12);
      return (i > 0 ? '<div class="funnel-arrow">▼</div>' : '') +
        '<div class="funnel-stage" style="width:' + widthPct + '%;">' +
        '<span class="funnel-stage-count">' + s.count + '</span>' +
        '<span>' + s.label + '</span>' +
        '</div>';
    }).join('');
  }

  // ─── Routing ───
  function navigate() {
    var hash = window.location.hash.replace('#', '') || 'home';
    var views = document.querySelectorAll('.view');
    var navItems = document.querySelectorAll('.nav-item');

    views.forEach(function (v) { v.classList.remove('active'); });
    navItems.forEach(function (n) { n.classList.remove('active'); });

    var targetView = document.getElementById('view-' + hash);
    var targetNav = document.querySelector('.nav-item[data-view="' + hash + '"]');

    if (targetView) targetView.classList.add('active');
    if (targetNav) targetNav.classList.add('active');

    var titles = {
      home: 'Dashboard',
      discover: 'Grant Discovery',
      pipeline: 'Application Pipeline',
      proposals: 'Proposal Workshop',
      analytics: 'Analytics'
    };
    var titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.textContent = titles[hash] || 'Dashboard';

    // Close mobile sidebar
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');

    // Render view-specific content
    if (hash === 'home') {
      renderDashboardKPIs();
      renderMiniPipeline();
      renderDeadlines();
      renderActivity();
    } else if (hash === 'discover') {
      if (state.searchResults.length === 0) {
        // Show recommended grants on first load
        state.searchResults = getMockGrants();
        renderSearchResults(state.searchResults);
        document.getElementById('searchResultCount').textContent = state.searchResults.length + ' recommended';
      }
    } else if (hash === 'pipeline') {
      renderKanban();
    } else if (hash === 'proposals') {
      renderProposals();
    } else if (hash === 'analytics') {
      renderAnalytics();
    }
  }

  // ─── Save / Apply Grant Actions ───
  function saveGrant(grantId) {
    var grant = state.searchResults.find(function (g) { return g.id === grantId; });
    if (!grant) return;
    if (state.savedGrants.some(function (s) { return s.id === grantId; })) return;

    state.savedGrants.push(grant);
    persistState();
    awardXP(50, 'Grant Opportunity Discovered');
    addActivity('blue', 'Saved grant: ' + grant.title);
    renderSearchResults(state.searchResults);
  }

  function quickApply(grantId) {
    var grant = state.searchResults.find(function (g) { return g.id === grantId; });
    if (!grant) return;
    if (state.pipeline.some(function (p) { return p.grantId === grantId; })) {
      showToast('Already in pipeline');
      return;
    }

    var item = {
      id: 'pipe-' + randomId(),
      title: grant.title.length > 50 ? grant.title.slice(0, 50) + '...' : grant.title,
      agency: grant.agency,
      deadline: grant.closeDate || '',
      stage: 'discovered',
      xpEarned: 50,
      grantId: grantId
    };

    state.pipeline.push(item);
    persistState();
    awardXP(50, 'Grant Opportunity Discovered');
    addActivity('green', 'Added to pipeline: ' + grant.title);
    renderSearchResults(state.searchResults);
    renderDashboardKPIs();
  }

  // ─── Event Bindings ───
  function bindEvents() {
    window.addEventListener('hashchange', navigate);

    // Hamburger
    document.getElementById('hamburger').addEventListener('click', function () {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebarOverlay').classList.toggle('active');
    });

    document.getElementById('sidebarOverlay').addEventListener('click', function () {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebarOverlay').classList.remove('active');
    });

    // Search
    document.getElementById('btnSearch').addEventListener('click', performSearch);
    document.getElementById('grantSearch').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') performSearch();
    });

    // Filters
    document.getElementById('filterAgency').addEventListener('change', performSearch);
    document.getElementById('filterStatus').addEventListener('change', performSearch);
    document.getElementById('filterCategory').addEventListener('change', performSearch);

    // Proposal editor
    document.getElementById('btnCloseEditor').addEventListener('click', closeEditor);
    document.getElementById('btnSaveSection').addEventListener('click', saveSection);
    document.getElementById('btnGenerateSection').addEventListener('click', generateSection);

    document.getElementById('proposalEditorOverlay').addEventListener('click', function (e) {
      if (e.target === document.getElementById('proposalEditorOverlay')) closeEditor();
    });

    // Delegated events
    document.addEventListener('click', function (e) {
      var target = e.target;

      // Grant card actions
      if (target.matches('[data-action="save"]')) {
        var gId = target.getAttribute('data-grant-id');
        saveGrant(gId);
      }
      if (target.matches('[data-action="apply"]')) {
        var applyId = target.getAttribute('data-grant-id');
        quickApply(applyId);
      }

      // Kanban card movement
      if (target.matches('[data-action="move-left"]')) {
        var cardIdL = target.getAttribute('data-card-id');
        moveCard(cardIdL, 'left');
      }
      if (target.matches('[data-action="move-right"]')) {
        var cardIdR = target.getAttribute('data-card-id');
        moveCard(cardIdR, 'right');
      }

      // Proposal section click
      var sectionCard = target.closest('.proposal-section-card');
      if (sectionCard) {
        var proposalId = sectionCard.getAttribute('data-proposal-id');
        openEditor(proposalId);
      }
    });

    // Add to pipeline button
    var addPipeBtn = document.getElementById('btnAddPipelineItem');
    if (addPipeBtn) {
      addPipeBtn.addEventListener('click', function () {
        window.location.hash = 'discover';
      });
    }
  }

  // ─── Init ───
  function init() {
    initPipeline();
    bindEvents();
    updateXPDisplay();
    navigate();

    // Initial welcome if no activity
    if (state.activity.length === 0) {
      addActivity('blue', 'Welcome to GrantFlow — Extropy Engine grant management');
      addActivity('green', 'Randall\'s profile loaded — entropy, information theory, IoT, decentralized systems');
      addActivity('yellow', 'Recommended grants pre-loaded based on your research profile');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
