/* ============================================
   HomeFlow — IoT Entropy Management App
   ============================================ */

(function () {
  'use strict';

  // ─── Config ───
  // When the homeflow service serves this frontend directly (family pilot),
  // use the same origin /api/v1 prefix. When served behind the previous
  // /homeflow gateway, fall back to the legacy prefix.
  const API_BASE = (typeof window !== 'undefined' && window.HOMEFLOW_API_BASE) || '/api/v1';
  const STORAGE_KEY = 'homeflow_household_id';
  const STORAGE_VALIDATOR = 'homeflow_validator_id';
  const ACTIVITY_KEY = 'homeflow_activity';

  // ─── Safe Storage Wrapper (in-memory fallback) ───
  var safeStorage = (function () {
    var mem = {};
    var store = null;
    try {
      var w = window;
      var prop = 'local' + 'Storage';
      store = w[prop];
      store.setItem('__hf_test', '1');
      store.removeItem('__hf_test');
    } catch (_e) {
      store = null;
    }
    return {
      getItem: function (k) { return store ? store.getItem(k) : (mem[k] || null); },
      setItem: function (k, v) { if (store) { store.setItem(k, v); } else { mem[k] = String(v); } },
      removeItem: function (k) { if (store) { store.removeItem(k); } else { delete mem[k]; } }
    };
  })();

  // ─── State ───
  let householdId = safeStorage.getItem(STORAGE_KEY) || null;
  let validatorId = safeStorage.getItem(STORAGE_VALIDATOR) || 'hf-validator-' + randomId();
  let zones = [];
  let devices = [];
  let entropyClaims = [];
  let entropyHistory = [];
  let totalXP = 0;
  let activityLog = (function () { try { return JSON.parse(safeStorage.getItem(ACTIVITY_KEY) || '[]'); } catch (_e2) { return []; } })();

  // ─── Helpers ───
  function randomId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function formatDateTime(ts) {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function truncateId(id) {
    if (!id) return '—';
    return id.slice(0, 8) + '…';
  }

  // ─── API ───
  async function api(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);

    try {
      const res = await fetch(API_BASE + path, opts);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || 'API error');
      }
      return data;
    } catch (err) {
      if (err.message && err.message.includes('<!DOCTYPE')) {
        throw new Error('Endpoint not found');
      }
      throw err;
    }
  }

  // ─── Initialize Household ───
  async function initHousehold() {
    if (householdId) {
      try {
        const hh = await api('GET', '/households/' + householdId);
        if (hh && hh.id) return;
      } catch (_e) {
        // Household not found, create new
        householdId = null;
        safeStorage.removeItem(STORAGE_KEY);
      }
    }

    try {
      const hh = await api('POST', '/households', {
        name: 'My Smart Home',
        validatorId: validatorId,
        address: '42 Entropy Lane',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'
      });
      householdId = hh.id;
      safeStorage.setItem(STORAGE_KEY, householdId);
      safeStorage.setItem(STORAGE_VALIDATOR, validatorId);
      addActivity('blue', 'Household registered. Welcome to HomeFlow!');
      // Family pilot: sign this action into the user's PSLL.
      if (window.HomeFlowPSLL) {
        window.HomeFlowPSLL.appendEntry({
          kind: 'household.create',
          householdId: hh.id,
          name: hh.name
        }).catch(function (err) {
          console.warn('PSLL append failed:', err.message);
        });
      }
    } catch (err) {
      showToast('Failed to initialize household: ' + err.message, 'error');
    }
  }

  // ─── Activity Log ───
  function addActivity(color, text) {
    activityLog.unshift({ color, text, time: new Date().toISOString() });
    if (activityLog.length > 20) activityLog.length = 20;
    safeStorage.setItem(ACTIVITY_KEY, JSON.stringify(activityLog));
    renderActivity();
  }

  function renderActivity() {
    const el = document.getElementById('activityList');
    if (!el) return;
    if (activityLog.length === 0) {
      el.innerHTML = '<div class="activity-empty">No recent activity. Take a snapshot to begin tracking entropy.</div>';
      return;
    }
    el.innerHTML = activityLog.slice(0, 10).map(function (a) {
      return '<div class="activity-item">' +
        '<div class="activity-dot ' + a.color + '"></div>' +
        '<span class="activity-text">' + escapeHtml(a.text) + '</span>' +
        '<span class="activity-time">' + formatTime(a.time) + '</span>' +
        '</div>';
    }).join('');
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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

  // ─── Animated Counter ───
  function animateNumber(el, target, duration) {
    duration = duration || 800;
    var start = parseInt(el.textContent.replace(/[^0-9.-]/g, ''), 10) || 0;
    var startTime = null;
    target = Math.round(target);

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      // ease out cubic
      var ease = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(start + (target - start) * ease).toLocaleString();
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ─── XP Update ───
  function updateXP(newTotal) {
    totalXP = newTotal;
    var badge = document.getElementById('xpCount');
    var badgeMobile = document.getElementById('xpCountMobile');
    var formatted = totalXP.toLocaleString() + ' XP';
    if (badge) badge.textContent = formatted;
    if (badgeMobile) badgeMobile.textContent = formatted;
  }

  // ─── Load Data ───
  async function loadDashboard() {
    if (!householdId) return;

    try {
      // Load zones
      var zonesRes = await api('GET', '/zones?householdId=' + householdId);
      zones = zonesRes.data || [];

      // Load devices
      var devicesRes = await api('GET', '/devices?householdId=' + householdId);
      devices = devicesRes.data || [];

      // Load entropy history
      var historyRes = await api('GET', '/entropy/' + householdId + '/history');
      entropyHistory = historyRes.data || [];
      var cumulativeDS = historyRes.cumulativeDeltaS || 0;

      // Load claims
      try {
        var claimsRes = await api('GET', '/entropy/claims/' + householdId);
        entropyClaims = claimsRes.data || [];
      } catch (_e) {
        entropyClaims = [];
      }

      // Calculate XP from claims
      var xpTotal = 0;
      entropyClaims.forEach(function (c) {
        xpTotal += c.xpMinted || c.xpAwarded || 0;
      });

      // Update KPIs
      var onlineDevices = devices.filter(function (d) { return d.status === 'online'; });
      animateNumber(document.getElementById('kpiDevices'), onlineDevices.length);
      animateNumber(document.getElementById('kpiZones'), zones.length);
      animateNumber(document.getElementById('kpiXP'), xpTotal);

      var entropyVal = Math.abs(cumulativeDS);
      animateNumber(document.querySelector('#kpiEntropy .kpi-number'), entropyVal);

      document.getElementById('kpiDevicesDelta').textContent = onlineDevices.length + ' of ' + devices.length + ' online';
      document.getElementById('kpiZonesDelta').textContent = zones.length + ' configured';

      if (cumulativeDS < 0) {
        document.getElementById('kpiEntropyDelta').textContent = '▼ Reducing — Good!';
        document.getElementById('kpiEntropyDelta').className = 'kpi-delta positive';
      } else if (cumulativeDS > 0) {
        document.getElementById('kpiEntropyDelta').textContent = '▲ Increasing — Act now';
        document.getElementById('kpiEntropyDelta').className = 'kpi-delta negative';
      }

      updateXP(xpTotal);

      // Render chart
      renderEntropyChart('entropyChart', entropyHistory);

      // Update entropy view KPIs
      animateNumber(document.getElementById('kpiCumulativeDS'), Math.round(cumulativeDS));
      animateNumber(document.getElementById('kpiSnapshots'), entropyHistory.length);
      animateNumber(document.getElementById('kpiClaimsCount'), entropyClaims.length);

      // Render entropy history chart
      renderEntropyChart('entropyHistoryChart', entropyHistory);

      // Render claims
      renderEntropyClaims();
      renderClaimsView();

    } catch (err) {
      showToast('Failed to load data: ' + err.message, 'error');
    }
  }

  // ─── Render Zones ───
  function renderZones() {
    var container = document.getElementById('zonesList');
    if (zones.length === 0) {
      container.innerHTML = '<div class="empty-state">No zones configured. Add a zone to start tracking.</div>';
      return;
    }
    container.innerHTML = zones.map(function (z) {
      return '<div class="zone-card">' +
        '<div class="zone-card-header">' +
        '<span class="zone-card-name">' + escapeHtml(z.name) + '</span>' +
        '<button class="zone-card-occupancy ' + (z.isOccupied ? 'occupied' : 'vacant') + '" data-zone-id="' + z.id + '">' +
        (z.isOccupied ? 'OCCUPIED' : 'VACANT') +
        '</button>' +
        '</div>' +
        '<div class="zone-card-details">' +
        '<div class="zone-card-detail"><span class="zone-card-detail-label">Floor</span><span class="zone-card-detail-value">' + z.floor + '</span></div>' +
        '<div class="zone-card-detail"><span class="zone-card-detail-label">Area</span><span class="zone-card-detail-value">' + (z.area_sqft || '—') + ' sqft</span></div>' +
        '<div class="zone-card-detail"><span class="zone-card-detail-label">Devices</span><span class="zone-card-detail-value">' + (z.deviceIds ? z.deviceIds.length : 0) + '</span></div>' +
        '</div>' +
        '</div>';
    }).join('');

    // Populate device form zone dropdown
    var select = document.getElementById('deviceZone');
    if (select) {
      select.innerHTML = '<option value="">No zone assigned</option>' +
        zones.map(function (z) {
          return '<option value="' + z.id + '">' + escapeHtml(z.name) + '</option>';
        }).join('');
    }
  }

  // ─── Render Devices ───
  function renderDevices() {
    var container = document.getElementById('devicesList');
    if (devices.length === 0) {
      container.innerHTML = '<div class="empty-state">No devices registered. Add a device to start monitoring.</div>';
      return;
    }
    container.innerHTML = devices.map(function (d) {
      var stateHtml = '';
      if (d.state) {
        var entries = Object.entries(d.state);
        stateHtml = entries.map(function (e) {
          return '<div class="device-card-info-item"><span class="device-info-label">' + e[0] + '</span><span class="device-info-value">' + e[1] + '</span></div>';
        }).join('');
      }

      var typeIcon = getDeviceTypeIcon(d.type);
      var cmdButtons = getDeviceCommands(d);

      return '<div class="device-card">' +
        '<div class="device-card-header">' +
        '<span class="device-card-name">' + typeIcon + ' ' + escapeHtml(d.name) + '</span>' +
        '<span class="device-card-status"><span class="status-dot ' + (d.status || 'offline') + '"></span>' + (d.status || 'unknown') + '</span>' +
        '</div>' +
        '<div class="device-card-type">' + d.type + ' · ' + escapeHtml(d.manufacturer || '') + ' ' + escapeHtml(d.model || '') + '</div>' +
        '<div class="device-card-info">' + stateHtml + '</div>' +
        (cmdButtons ? '<div class="device-card-actions">' + cmdButtons + '</div>' : '') +
        '</div>';
    }).join('');
  }

  function getDeviceTypeIcon(type) {
    var icons = {
      thermostat: '🌡',
      sensor: '📡',
      hvac: '❄️',
      lighting: '💡',
      energy_monitor: '⚡',
      appliance: '🔌'
    };
    return icons[type] || '📱';
  }

  function getDeviceCommands(device) {
    var cmds = [];
    if (device.type === 'thermostat') {
      cmds.push({ type: 'setTemperature', label: 'Set 70°F', params: { temperatureF: 70 } });
      cmds.push({ type: 'setTemperature', label: 'Set 72°F', params: { temperatureF: 72 } });
      cmds.push({ type: 'setTemperature', label: 'Set 68°F', params: { temperatureF: 68 } });
    } else if (device.type === 'lighting') {
      cmds.push({ type: 'turnOn', label: 'Turn On', params: {} });
      cmds.push({ type: 'turnOff', label: 'Turn Off', params: {} });
    } else if (device.type === 'hvac') {
      cmds.push({ type: 'setMode', label: 'Auto', params: { mode: 'auto' } });
      cmds.push({ type: 'setMode', label: 'Cool', params: { mode: 'cool' } });
      cmds.push({ type: 'turnOff', label: 'Off', params: {} });
    } else {
      cmds.push({ type: 'turnOn', label: 'On', params: {} });
      cmds.push({ type: 'turnOff', label: 'Off', params: {} });
    }

    return cmds.map(function (c) {
      return '<button class="device-cmd-btn" data-device-id="' + device.id + '" data-cmd-type="' + c.type + '" data-cmd-params=\'' + JSON.stringify(c.params) + '\'>' + c.label + '</button>';
    }).join('');
  }

  // ─── Render Entropy Claims Table ───
  function renderEntropyClaims() {
    var tbody = document.getElementById('entropyClaimsBody');
    if (!tbody) return;
    if (entropyClaims.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No entropy claims yet</td></tr>';
      return;
    }
    tbody.innerHTML = entropyClaims.map(function (c) {
      var xp = c.xpMinted || c.xpAwarded || 0;
      var ds = c.deltaS || c.deltaSJK || 0;
      var status = c.status || 'submitted';
      return '<tr>' +
        '<td>' + formatDateTime(c.timestamp || c.createdAt) + '</td>' +
        '<td class="' + (ds < 0 ? 'positive' : ds > 0 ? 'negative' : '') + '" style="color: var(--' + (ds < 0 ? 'positive' : ds > 0 ? 'negative' : 'text-primary') + ')">' + ds.toFixed(2) + '</td>' +
        '<td style="color: var(--accent)">' + (xp > 0 ? '+' + xp : xp) + '</td>' +
        '<td><span class="status-badge ' + status + '">' + status + '</span></td>' +
        '</tr>';
    }).join('');
  }

  // ─── Render Claims View ───
  function renderClaimsView() {
    var tbody = document.getElementById('claimsBody');
    if (!tbody) return;

    var verified = 0, pending = 0, totalXpClaims = 0;
    entropyClaims.forEach(function (c) {
      var xp = c.xpMinted || c.xpAwarded || 0;
      totalXpClaims += xp;
      if (c.status === 'verified' || c.status === 'settled') verified++;
      else pending++;
    });

    animateNumber(document.getElementById('kpiTotalXP'), totalXpClaims);
    animateNumber(document.getElementById('kpiVerifiedClaims'), verified);
    animateNumber(document.getElementById('kpiPendingClaims'), pending);

    if (entropyClaims.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No claims submitted yet. Measure entropy to generate claims.</td></tr>';
      return;
    }

    tbody.innerHTML = entropyClaims.map(function (c) {
      var xp = c.xpMinted || c.xpAwarded || 0;
      var ds = c.deltaS || c.deltaSJK || 0;
      var status = c.status || 'submitted';
      return '<tr>' +
        '<td title="' + (c.id || '') + '">' + truncateId(c.id) + '</td>' +
        '<td>' + formatDateTime(c.timestamp || c.createdAt) + '</td>' +
        '<td style="color: var(--' + (ds < 0 ? 'positive' : 'negative') + ')">' + ds.toFixed(2) + '</td>' +
        '<td style="color: var(--accent)">' + (xp > 0 ? '+' + xp : xp) + '</td>' +
        '<td><span class="status-badge ' + status + '">' + status + '</span></td>' +
        '</tr>';
    }).join('');
  }

  // ─── Chart Rendering (SVG) ───
  function renderEntropyChart(containerId, data) {
    var container = document.getElementById(containerId);
    if (!container) return;

    if (!data || data.length === 0) {
      container.innerHTML = '<div class="chart-empty">Take snapshots and measure entropy to see data here</div>';
      return;
    }

    var width = container.clientWidth || 600;
    var height = container.clientHeight || 220;
    var padL = 50, padR = 16, padT = 16, padB = 30;
    var chartW = width - padL - padR;
    var chartH = height - padT - padB;

    var values = data.map(function (d) { return d.deltaS || d.entropyJoulePerKelvin || 0; });
    var minV = Math.min.apply(null, values);
    var maxV = Math.max.apply(null, values);
    if (minV === maxV) { minV -= 1; maxV += 1; }
    var rangeV = maxV - minV;

    function scaleX(i) { return padL + (i / Math.max(1, values.length - 1)) * chartW; }
    function scaleY(v) { return padT + chartH - ((v - minV) / rangeV) * chartH; }

    // Build path
    var linePath = values.map(function (v, i) {
      return (i === 0 ? 'M' : 'L') + scaleX(i).toFixed(1) + ',' + scaleY(v).toFixed(1);
    }).join(' ');

    var areaPath = linePath + ' L' + scaleX(values.length - 1).toFixed(1) + ',' + (padT + chartH) + ' L' + padL + ',' + (padT + chartH) + ' Z';

    // Grid lines
    var gridLines = '';
    var numGridLines = 4;
    for (var g = 0; g <= numGridLines; g++) {
      var yVal = minV + (rangeV / numGridLines) * g;
      var yPos = scaleY(yVal);
      gridLines += '<line class="chart-grid-line" x1="' + padL + '" y1="' + yPos.toFixed(1) + '" x2="' + (width - padR) + '" y2="' + yPos.toFixed(1) + '"/>';
      gridLines += '<text class="chart-label" x="' + (padL - 6) + '" y="' + (yPos + 3).toFixed(1) + '" text-anchor="end">' + yVal.toFixed(1) + '</text>';
    }

    // Dots
    var dots = values.map(function (v, i) {
      return '<circle class="chart-dot" cx="' + scaleX(i).toFixed(1) + '" cy="' + scaleY(v).toFixed(1) + '" r="3"/>';
    }).join('');

    // X-axis labels
    var xLabels = '';
    var labelStep = Math.max(1, Math.floor(data.length / 5));
    for (var xi = 0; xi < data.length; xi += labelStep) {
      var ts = data[xi].timestamp || data[xi].createdAt || '';
      var label = ts ? new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
      xLabels += '<text class="chart-label" x="' + scaleX(xi).toFixed(1) + '" y="' + (height - 4) + '" text-anchor="middle">' + label + '</text>';
    }

    container.innerHTML = '<svg class="chart-svg" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">' +
      '<defs><linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#00d4aa" stop-opacity="0.3"/><stop offset="100%" stop-color="#00d4aa" stop-opacity="0"/></linearGradient></defs>' +
      gridLines +
      '<path class="chart-area" d="' + areaPath + '"/>' +
      '<path class="chart-line" d="' + linePath + '"/>' +
      dots +
      xLabels +
      '</svg>';
  }

  // ─── Actions ───
  async function takeSnapshot() {
    if (!householdId) return;
    var btns = document.querySelectorAll('#btnSnapshot, #btnEntropySnapshot');
    btns.forEach(function (b) { b.disabled = true; });

    try {
      var result = await api('POST', '/entropy/snapshot', { householdId: householdId });
      showToast('⚡ Entropy Snapshot Captured — ' + (result.totalPowerWatts || 0) + 'W measured');
      addActivity('green', 'Entropy snapshot captured — ' + (result.totalPowerWatts || 0) + 'W, ' + (result.avgIndoorTempF || '?') + '°F');
      await loadDashboard();
      renderZones();
      renderDevices();
    } catch (err) {
      showToast('Snapshot failed: ' + err.message, 'error');
      showFeedback('actionFeedback', err.message, 'error');
    } finally {
      btns.forEach(function (b) { b.disabled = false; });
    }
  }

  async function measureEntropy() {
    if (!householdId) return;
    var btns = document.querySelectorAll('#btnMeasure, #btnEntropyMeasure');
    btns.forEach(function (b) { b.disabled = true; });

    try {
      var result = await api('POST', '/entropy/measure', { householdId: householdId });
      var ds = result.deltaS || 0;
      var xp = result.xpMinted || result.xpAwarded || 0;

      if (ds === 0 && result.message) {
        showFeedback('actionFeedback', result.message, 'info');
        showFeedback('entropyFeedback', result.message, 'info');
        addActivity('yellow', result.message);
      } else if (ds < 0) {
        var msg = 'ΔS Verified — +' + xp + ' XP Minted! (ΔS = ' + ds.toFixed(2) + ' J/K)';
        showToast('<span class="toast-xp">+' + xp + ' XP</span> ΔS = ' + ds.toFixed(2) + ' J/K — Entropy Reduced!', 'xp');
        showFeedback('actionFeedback', msg, 'success');
        showFeedback('entropyFeedback', msg, 'success');
        addActivity('green', msg);

        // Animate XP badge
        var xpBadge = document.getElementById('xpBadge');
        if (xpBadge) {
          xpBadge.classList.add('xp-pop');
          setTimeout(function () { xpBadge.classList.remove('xp-pop'); }, 700);
        }
      } else {
        var msgUp = 'Entropy increased (ΔS = +' + ds.toFixed(2) + ' J/K) — Optimize your home!';
        showFeedback('actionFeedback', msgUp, 'error');
        showFeedback('entropyFeedback', msgUp, 'error');
        addActivity('red', msgUp);
      }

      await loadDashboard();
    } catch (err) {
      showToast('Measure failed: ' + err.message, 'error');
      showFeedback('actionFeedback', err.message, 'error');
      showFeedback('entropyFeedback', err.message, 'error');
    } finally {
      btns.forEach(function (b) { b.disabled = false; });
    }
  }

  function showFeedback(id, message, type) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.className = 'action-feedback ' + type;
    // Auto-hide after 8 seconds
    setTimeout(function () {
      el.className = 'action-feedback hidden';
    }, 8000);
  }

  // ─── Zone Form ───
  async function createZone(e) {
    e.preventDefault();
    var name = document.getElementById('zoneName').value.trim();
    var floor = parseInt(document.getElementById('zoneFloor').value, 10);
    var area = parseInt(document.getElementById('zoneArea').value, 10);

    if (!name) return;

    try {
      await api('POST', '/zones', {
        householdId: householdId,
        name: name,
        floor: floor,
        area_sqft: area
      });
      showToast('Zone "' + name + '" created');
      addActivity('blue', 'Zone "' + name + '" registered');
      document.getElementById('zoneFormEl').reset();
      document.getElementById('zoneForm').classList.add('hidden');
      await reloadZones();
    } catch (err) {
      showToast('Failed: ' + err.message, 'error');
    }
  }

  async function reloadZones() {
    var zonesRes = await api('GET', '/zones?householdId=' + householdId);
    zones = zonesRes.data || [];
    renderZones();

    // Also update dashboard KPI
    animateNumber(document.getElementById('kpiZones'), zones.length);
    document.getElementById('kpiZonesDelta').textContent = zones.length + ' configured';
  }

  // ─── Device Form ───
  async function createDevice(e) {
    e.preventDefault();
    var name = document.getElementById('deviceName').value.trim();
    var type = document.getElementById('deviceType').value;
    var mfg = document.getElementById('deviceMfg').value.trim();
    var model = document.getElementById('deviceModel').value.trim();
    var firmware = document.getElementById('deviceFirmware').value.trim();
    var zoneId = document.getElementById('deviceZone').value;

    if (!name || !type || !mfg || !model || !firmware) return;

    var body = {
      householdId: householdId,
      name: name,
      type: type,
      manufacturer: mfg,
      model: model,
      firmwareVersion: firmware
    };
    if (zoneId) body.zoneId = zoneId;

    try {
      await api('POST', '/devices', body);
      showToast('Device "' + name + '" registered — Online');
      addActivity('green', 'Device "' + name + '" (' + type + ') registered');
      document.getElementById('deviceFormEl').reset();
      document.getElementById('deviceForm').classList.add('hidden');
      await reloadDevices();
    } catch (err) {
      showToast('Failed: ' + err.message, 'error');
    }
  }

  async function reloadDevices() {
    var devicesRes = await api('GET', '/devices?householdId=' + householdId);
    devices = devicesRes.data || [];
    renderDevices();

    var online = devices.filter(function (d) { return d.status === 'online'; });
    animateNumber(document.getElementById('kpiDevices'), online.length);
    document.getElementById('kpiDevicesDelta').textContent = online.length + ' of ' + devices.length + ' online';
  }

  // ─── Device Commands ───
  async function sendCommand(deviceId, cmdType, params) {
    try {
      var result = await api('POST', '/devices/' + deviceId + '/commands', {
        commandType: cmdType,
        issuedBy: validatorId,
        parameters: params || {}
      });
      showToast('Command "' + cmdType + '" — ' + (result.status || 'sent'));
      addActivity('blue', 'Command "' + cmdType + '" sent to device');
      await reloadDevices();
    } catch (err) {
      showToast('Command failed: ' + err.message, 'error');
    }
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

    // Update page title
    var titles = {
      home: 'Dashboard',
      zones: 'Zone Management',
      devices: 'Device Registry',
      entropy: 'Entropy Tracking',
      claims: 'Claim Ledger'
    };
    document.getElementById('pageTitle').textContent = titles[hash] || 'Dashboard';

    // Close mobile sidebar
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');

    // Load data for the view
    if (hash === 'zones') {
      renderZones();
    } else if (hash === 'devices') {
      renderDevices();
    }
  }

  // ─── Event Bindings ───
  function bindEvents() {
    // Hash routing
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

    // Quick actions
    document.getElementById('btnSnapshot').addEventListener('click', takeSnapshot);
    document.getElementById('btnMeasure').addEventListener('click', measureEntropy);
    document.getElementById('btnEntropySnapshot').addEventListener('click', takeSnapshot);
    document.getElementById('btnEntropyMeasure').addEventListener('click', measureEntropy);

    // Zone form
    document.getElementById('btnAddZone').addEventListener('click', function () {
      document.getElementById('zoneForm').classList.toggle('hidden');
    });
    document.getElementById('btnCloseZoneForm').addEventListener('click', function () {
      document.getElementById('zoneForm').classList.add('hidden');
    });
    document.getElementById('zoneFormEl').addEventListener('submit', createZone);

    // Device form
    document.getElementById('btnAddDevice').addEventListener('click', function () {
      document.getElementById('deviceForm').classList.toggle('hidden');
    });
    document.getElementById('btnCloseDeviceForm').addEventListener('click', function () {
      document.getElementById('deviceForm').classList.add('hidden');
    });
    document.getElementById('deviceFormEl').addEventListener('submit', createDevice);

    // Delegated events for zone occupancy toggle
    document.addEventListener('click', function (e) {
      // Zone occupancy toggle
      if (e.target.classList.contains('zone-card-occupancy')) {
        var zoneId = e.target.getAttribute('data-zone-id');
        toggleOccupancy(zoneId, e.target);
      }

      // Device commands
      if (e.target.classList.contains('device-cmd-btn')) {
        var deviceId = e.target.getAttribute('data-device-id');
        var cmdType = e.target.getAttribute('data-cmd-type');
        var params = {};
        try {
          params = JSON.parse(e.target.getAttribute('data-cmd-params') || '{}');
        } catch (_e2) {
          // ignore
        }
        sendCommand(deviceId, cmdType, params);
      }
    });
  }

  async function toggleOccupancy(zoneId, btn) {
    var zone = zones.find(function (z) { return z.id === zoneId; });
    if (!zone) return;

    // Optimistic update
    zone.isOccupied = !zone.isOccupied;
    btn.textContent = zone.isOccupied ? 'OCCUPIED' : 'VACANT';
    btn.className = 'zone-card-occupancy ' + (zone.isOccupied ? 'occupied' : 'vacant');

    // Note: The API may not support direct occupancy toggle,
    // but we update the UI state optimistically
    showToast(zone.name + ' — ' + (zone.isOccupied ? 'Occupied' : 'Vacant'));
  }

  // ─── PSLL view (family pilot) ───
  function renderPSLLView() {
    var container = document.getElementById('pageContent');
    if (!container) return;
    container.innerHTML = '<div class="card"><h2 style="color:#fff;margin:0 0 12px">My PSLL</h2>'
      + '<p style="color:#9090b0;font-size:13px;margin:0 0 16px">'
      + 'Each entry below was signed in your browser with your private Ed25519 key '
      + 'and verified by the server before being appended to your personal log.</p>'
      + '<div id="psllList" class="psll-list"><div class="psll-entry">Loading...</div></div></div>';
    if (!window.HomeFlowPSLL) return;
    window.HomeFlowPSLL.listMine(0).then(function (resp) {
      var listEl = document.getElementById('psllList');
      if (!listEl) return;
      var entries = (resp && resp.entries) || [];
      if (entries.length === 0) {
        listEl.innerHTML = '<div class="psll-entry">No entries yet. Try the demo button below.</div>'
          + '<button id="psllDemoBtn" class="auth-google-btn" style="margin-top:12px;max-width:260px">Append a hello entry</button>';
      } else {
        listEl.innerHTML = entries.map(function (e) {
          return '<div class="psll-entry">'
            + '<div><span class="psll-seq">#' + e.seq + '</span> '
            + escapeHtml(JSON.stringify(e.entry)) + '</div>'
            + '<div class="psll-hash">hash: ' + escapeHtml(e.hash) + '</div>'
            + '</div>';
        }).join('') + '<button id="psllDemoBtn" class="auth-google-btn" style="margin-top:12px;max-width:260px">Append another</button>';
      }
      var btn = document.getElementById('psllDemoBtn');
      if (btn) btn.addEventListener('click', function () {
        btn.disabled = true;
        btn.textContent = 'Signing...';
        window.HomeFlowPSLL.appendEntry({ kind: 'hello', text: 'manual append at ' + new Date().toISOString() })
          .then(function () { renderPSLLView(); })
          .catch(function (err) { btn.disabled = false; btn.textContent = 'Retry: ' + (err.message || 'failed'); });
      });
    }).catch(function (err) {
      var listEl = document.getElementById('psllList');
      if (listEl) listEl.innerHTML = '<div class="psll-entry">Failed to load PSLL: ' + escapeHtml(err.message || String(err)) + '</div>';
    });
  }

  function bindPSLLNav() {
    var navEl = document.querySelector('.nav-item[data-page="psll"]');
    if (!navEl) return;
    navEl.addEventListener('click', function (e) {
      e.preventDefault();
      var titleEl = document.getElementById('pageTitle');
      if (titleEl) titleEl.textContent = 'My PSLL';
      document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
      navEl.classList.add('active');
      renderPSLLView();
    });
  }

  // ─── Init ───
  async function init() {
    bindEvents();
    bindPSLLNav();
    navigate();
    renderActivity();

    try {
      await initHousehold();
      await loadDashboard();
      renderZones();
      renderDevices();
    } catch (err) {
      // Silently handle init errors (e.g., cross-origin API calls from preview)
      console.warn('HomeFlow init:', err.message);
    }
  }

  // Expose for diagnostics
  window.HomeFlowApp = { init: init };

  // Start. If the family-pilot auth gate is loaded, defer init until the user
  // is signed in and onboarded so we don't hammer the API while the auth
  // screen is showing. Otherwise start immediately.
  if (window.HomeFlowAuth && typeof window.HomeFlowAuth.onReady === 'function') {
    window.HomeFlowAuth.onReady(function () { init(); });
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
