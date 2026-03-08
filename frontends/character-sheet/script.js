/* =============================================
   XP Character Sheet — Extropy Engine
   Radar Chart, Animated Counters, Fade-ins
   ============================================= */

(function () {
  'use strict';

  // ===== RADAR CHART =====
  const domainData = [
    { name: 'CODE',          value: 4800, color: '#00d4aa' },
    { name: 'COGNITIVE',     value: 3200, color: '#00c2ff' },
    { name: 'INFORMATIONAL', value: 2100, color: '#7c83ff' },
    { name: 'GOVERNANCE',    value: 1800, color: '#e040fb' },
    { name: 'THERMODYNAMIC', value: 1200, color: '#ff9f43' },
    { name: 'SOCIAL',        value: 800,  color: '#ff6b6b' },
    { name: 'ECONOMIC',      value: 600,  color: '#FFC553' },
    { name: 'TEMPORAL',      value: 400,  color: '#4da6ff' },
  ];

  const maxValue = 5000;
  const cx = 250, cy = 240;
  const chartRadius = 145;
  const levels = 5;
  const numAxes = domainData.length;
  const angleStep = (2 * Math.PI) / numAxes;
  const startAngle = -Math.PI / 2;

  function polarToCart(angle, radius) {
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  }

  function buildRadar() {
    const svg = document.getElementById('radarChart');
    if (!svg) return;
    svg.setAttribute('viewBox', '-10 0 520 510');

    let svgContent = '';

    // Grid levels
    for (let l = 1; l <= levels; l++) {
      const r = (chartRadius / levels) * l;
      let points = '';
      for (let i = 0; i < numAxes; i++) {
        const angle = startAngle + i * angleStep;
        const p = polarToCart(angle, r);
        points += `${p.x},${p.y} `;
      }
      svgContent += `<polygon points="${points.trim()}" fill="none" stroke="#1a2430" stroke-width="1" opacity="${l === levels ? '0.6' : '0.3'}"/>`;
    }

    // Axis lines
    for (let i = 0; i < numAxes; i++) {
      const angle = startAngle + i * angleStep;
      const p = polarToCart(angle, chartRadius);
      svgContent += `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="#1a2430" stroke-width="1" opacity="0.4"/>`;
    }

    // Axis labels
    for (let i = 0; i < numAxes; i++) {
      const angle = startAngle + i * angleStep;
      const labelR = chartRadius + 28;
      const p = polarToCart(angle, labelR);
      let anchor = 'middle';
      if (p.x < cx - 10) anchor = 'end';
      else if (p.x > cx + 10) anchor = 'start';
      let dy = '0.35em';
      if (p.y < cy - chartRadius) dy = '0em';
      else if (p.y > cy + chartRadius - 10) dy = '0.8em';
      // Shorten long labels
      var label = domainData[i].name;
      if (label === 'INFORMATIONAL') label = 'INFO';
      if (label === 'THERMODYNAMIC') label = 'THERMO';
      svgContent += `<text x="${p.x}" y="${p.y}" text-anchor="${anchor}" dy="${dy}" fill="${domainData[i].color}" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="600" letter-spacing="0.04em">${label}</text>`;
    }

    // Data polygon (animated via CSS)
    let dataPoints = '';
    for (let i = 0; i < numAxes; i++) {
      const angle = startAngle + i * angleStep;
      const r = (domainData[i].value / maxValue) * chartRadius;
      const p = polarToCart(angle, r);
      dataPoints += `${p.x},${p.y} `;
    }
    svgContent += `
      <polygon class="radar-data-polygon" points="${dataPoints.trim()}" fill="rgba(0, 212, 170, 0.1)" stroke="#00d4aa" stroke-width="2" stroke-linejoin="round"/>
    `;

    // Data points with glow
    for (let i = 0; i < numAxes; i++) {
      const angle = startAngle + i * angleStep;
      const r = (domainData[i].value / maxValue) * chartRadius;
      const p = polarToCart(angle, r);
      svgContent += `<circle cx="${p.x}" cy="${p.y}" r="5" fill="${domainData[i].color}" opacity="0.9"/>`;
      svgContent += `<circle cx="${p.x}" cy="${p.y}" r="8" fill="${domainData[i].color}" opacity="0.2"/>`;
    }

    // Center point
    svgContent += `<circle cx="${cx}" cy="${cy}" r="3" fill="#00d4aa" opacity="0.4"/>`;

    svg.innerHTML += svgContent;
  }

  // Build legend
  function buildLegend() {
    const legend = document.getElementById('radarLegend');
    if (!legend) return;
    domainData.forEach(function (d) {
      const pct = Math.min((d.value / maxValue) * 100, 100);
      const item = document.createElement('div');
      item.className = 'radar-legend-item';
      item.innerHTML = `
        <span class="radar-legend-color" style="background: ${d.color}"></span>
        <span class="radar-legend-name">${d.name}</span>
        <span class="radar-legend-value">${d.value.toLocaleString()}</span>
        <div class="radar-legend-bar-track">
          <div class="radar-legend-bar-fill" data-width="${pct}" style="background: ${d.color}; opacity: 0.7;"></div>
        </div>
      `;
      legend.appendChild(item);
    });
  }

  // ===== ANIMATED NUMBER COUNTERS =====
  function animateCounter(el, target, duration, isDecimal) {
    const start = 0;
    const startTime = performance.now();
    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = start + (target - start) * ease;
      if (isDecimal) {
        el.textContent = current.toFixed(1);
      } else {
        el.textContent = Math.round(current).toLocaleString();
      }
      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    }
    requestAnimationFrame(tick);
  }

  function initCounters() {
    document.querySelectorAll('[data-count]').forEach(function (el) {
      const target = parseInt(el.getAttribute('data-count'), 10);
      if (!isNaN(target)) {
        animateCounter(el, target, 1800, false);
      }
    });
    document.querySelectorAll('[data-count-decimal]').forEach(function (el) {
      const target = parseFloat(el.getAttribute('data-count-decimal'));
      if (!isNaN(target)) {
        animateCounter(el, target, 1800, true);
      }
    });
  }

  // ===== PROGRESS BARS =====
  function animateBars() {
    document.querySelectorAll('[data-width]').forEach(function (el, i) {
      const w = parseFloat(el.getAttribute('data-width'));
      setTimeout(function () {
        el.style.width = w + '%';
      }, 300 + i * 80);
    });
  }

  // ===== SECTION FADE-IN =====
  function initFadeIn() {
    const sections = document.querySelectorAll('.section-animate');
    if (!sections.length) return;

    var scrollRoot = document.querySelector('.main-scroll');

    // Use IntersectionObserver for scroll-based reveal
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.05, root: scrollRoot });

      sections.forEach(function (sec, i) {
        sec.style.transitionDelay = (i * 0.08) + 's';
        observer.observe(sec);
      });
    } else {
      sections.forEach(function (sec) {
        sec.classList.add('visible');
      });
    }
  }

  // ===== INIT =====
  function init() {
    buildRadar();
    buildLegend();
    initFadeIn();
    // Delay counters and bars until hero is visible
    setTimeout(function () {
      initCounters();
    }, 200);
    // Stagger bars a bit more to let DOM settle
    setTimeout(function () {
      animateBars();
    }, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
