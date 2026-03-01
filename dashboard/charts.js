// charts.js — Chart.js wrapper functions
// Chart.js loaded via CDN in index.html

const CHART_COLORS = {
  primary: '#4f98a3',
  gold: '#d19900',
  success: '#4caf50',
  error: '#ef5350',
  warning: '#ff9800',
  blue: '#42a5f5',
  purple: '#ab47bc',
  cyan: '#26c6da',
};

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 600, easing: 'easeOutQuart' },
  plugins: {
    legend: {
      display: false,
    },
    tooltip: {
      backgroundColor: '#1a1e26',
      borderColor: '#333b4d',
      borderWidth: 1,
      titleFont: { family: "'JetBrains Mono', monospace", size: 11, weight: '600' },
      bodyFont: { family: "'Inter', sans-serif", size: 12 },
      padding: 10,
      cornerRadius: 6,
      displayColors: true,
      boxPadding: 4,
    },
  },
};

function getTextColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted').trim() || '#8b93a6';
}
function getGridColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-divider').trim() || '#222838';
}

export function createLineChart(canvas, labels, datasets, options = {}) {
  const textColor = getTextColor();
  const gridColor = getGridColor();

  return new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((ds, i) => ({
        label: ds.label || `Series ${i + 1}`,
        data: ds.data,
        borderColor: ds.color || CHART_COLORS.primary,
        backgroundColor: (ds.color || CHART_COLORS.primary) + '15',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: ds.color || CHART_COLORS.primary,
        tension: 0.4,
        fill: ds.fill !== false,
        ...ds,
      })),
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        x: {
          grid: { color: gridColor, drawBorder: false },
          ticks: { color: textColor, font: { family: "'JetBrains Mono', monospace", size: 10 } },
        },
        y: {
          grid: { color: gridColor, drawBorder: false },
          ticks: { color: textColor, font: { family: "'JetBrains Mono', monospace", size: 10 } },
          beginAtZero: options.beginAtZero !== false,
        },
      },
      ...options,
    },
  });
}

export function createBarChart(canvas, labels, datasets, options = {}) {
  const textColor = getTextColor();
  const gridColor = getGridColor();

  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map((ds, i) => ({
        label: ds.label || `Series ${i + 1}`,
        data: ds.data,
        backgroundColor: ds.colors || ds.color || CHART_COLORS.primary,
        borderRadius: 4,
        borderSkipped: false,
        barPercentage: 0.6,
        ...ds,
      })),
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: textColor, font: { family: "'JetBrains Mono', monospace", size: 10 } },
        },
        y: {
          grid: { color: gridColor, drawBorder: false },
          ticks: { color: textColor, font: { family: "'JetBrains Mono', monospace", size: 10 } },
          beginAtZero: true,
        },
      },
      ...options,
    },
  });
}

export function createDoughnutChart(canvas, labels, data, colors, options = {}) {
  return new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 0,
        hoverOffset: 4,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      cutout: '70%',
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: {
          display: options.showLegend || false,
          position: 'bottom',
          labels: {
            color: getTextColor(),
            font: { family: "'Inter', sans-serif", size: 11 },
            padding: 12,
            usePointStyle: true,
            pointStyleWidth: 8,
          },
        },
      },
      ...options,
    },
  });
}

export function createRadarChart(canvas, labels, data, options = {}) {
  const textColor = getTextColor();
  const gridColor = getGridColor();

  return new Chart(canvas, {
    type: 'radar',
    data: {
      labels,
      datasets: [{
        label: 'Reputation',
        data,
        backgroundColor: CHART_COLORS.primary + '20',
        borderColor: CHART_COLORS.primary,
        borderWidth: 2,
        pointBackgroundColor: CHART_COLORS.primary,
        pointBorderColor: '#0d0f12',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        r: {
          beginAtZero: true,
          max: 10,
          ticks: {
            stepSize: 2,
            color: textColor,
            backdropColor: 'transparent',
            font: { family: "'JetBrains Mono', monospace", size: 9 },
          },
          grid: { color: gridColor },
          angleLines: { color: gridColor },
          pointLabels: {
            color: textColor,
            font: { family: "'Inter', sans-serif", size: 10 },
          },
        },
      },
      ...options,
    },
  });
}

// Sparkline — tiny inline chart
export function createSparkline(canvas, data, color = CHART_COLORS.primary) {
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.map((_, i) => i),
      datasets: [{
        data,
        borderColor: color,
        backgroundColor: color + '15',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.4,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false },
      },
    },
  });
}

export { CHART_COLORS };
