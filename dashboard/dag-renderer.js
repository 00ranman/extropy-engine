// dag-renderer.js — Canvas-based DAG visualization with zoom, pan, glow effects
import { dagVertices, VERTEX_TYPES } from './data.js';

const NODE_RADIUS = 14;
const GLOW_RADIUS = 24;
const EDGE_PARTICLE_SPEED = 0.003;

export class DAGRenderer {
  constructor(canvas, onNodeClick) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onNodeClick = onNodeClick;
    this.nodes = [];
    this.edges = [];
    this.particles = [];
    this.offsetX = 0;
    this.offsetY = 0;
    this.scale = 1;
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.hoveredNode = null;
    this.selectedNode = null;
    this.activeFilters = new Set(Object.keys(VERTEX_TYPES));
    this.animFrame = null;
    this.time = 0;
    this.dpr = window.devicePixelRatio || 1;

    this._initNodes();
    this._initEdges();
    this._initParticles();
    this._bindEvents();
    this._resize();
    this._startAnimation();
  }

  _initNodes() {
    const vertices = dagVertices;
    const cols = Math.ceil(Math.sqrt(vertices.length * 1.5));
    const spacingX = 120;
    const spacingY = 90;

    // Use a topological-like layout
    const depths = {};
    vertices.forEach((v, i) => {
      let maxParentDepth = -1;
      v.parents.forEach(pid => {
        const parentIdx = vertices.findIndex(vv => vv.id === pid);
        if (parentIdx >= 0 && depths[parentIdx] !== undefined) {
          maxParentDepth = Math.max(maxParentDepth, depths[parentIdx]);
        }
      });
      depths[i] = maxParentDepth + 1;
    });

    const maxDepth = Math.max(...Object.values(depths), 0);
    const depthBuckets = {};
    vertices.forEach((v, i) => {
      const d = depths[i];
      if (!depthBuckets[d]) depthBuckets[d] = [];
      depthBuckets[d].push(i);
    });

    vertices.forEach((v, i) => {
      const depth = depths[i];
      const bucket = depthBuckets[depth];
      const posInBucket = bucket.indexOf(i);
      const bucketSize = bucket.length;
      const x = depth * spacingX + 80 + (Math.random() * 30 - 15);
      const y = (posInBucket - bucketSize / 2) * spacingY + 400 + (Math.random() * 20 - 10);

      this.nodes.push({
        id: v.id,
        x, y,
        type: v.type,
        confirmed: v.confirmed,
        data: v,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: 0.5 + Math.random() * 0.5,
      });
    });
  }

  _initEdges() {
    const nodeMap = {};
    this.nodes.forEach((n, i) => nodeMap[n.id] = i);

    dagVertices.forEach((v, i) => {
      v.parents.forEach(pid => {
        if (nodeMap[pid] !== undefined) {
          this.edges.push({
            from: nodeMap[pid],
            to: i,
          });
        }
      });
    });
  }

  _initParticles() {
    // Create flowing particles on edges
    this.particles = [];
    const particleCount = Math.min(this.edges.length * 2, 80);
    for (let i = 0; i < particleCount; i++) {
      const edgeIdx = Math.floor(Math.random() * this.edges.length);
      this.particles.push({
        edgeIdx,
        progress: Math.random(),
        speed: EDGE_PARTICLE_SPEED + Math.random() * 0.002,
        size: 1.5 + Math.random() * 1.5,
      });
    }
  }

  _bindEvents() {
    const c = this.canvas;

    c.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStart = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY };
      c.style.cursor = 'grabbing';
    });

    c.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        this.offsetX = e.clientX - this.dragStart.x;
        this.offsetY = e.clientY - this.dragStart.y;
        return;
      }

      const rect = c.getBoundingClientRect();
      const mx = (e.clientX - rect.left - this.offsetX) / this.scale;
      const my = (e.clientY - rect.top - this.offsetY) / this.scale;

      let found = null;
      for (let i = this.nodes.length - 1; i >= 0; i--) {
        const n = this.nodes[i];
        if (!this.activeFilters.has(n.type)) continue;
        const dx = mx - n.x;
        const dy = my - n.y;
        if (dx * dx + dy * dy < NODE_RADIUS * NODE_RADIUS * 2) {
          found = n;
          break;
        }
      }
      this.hoveredNode = found;
      c.style.cursor = found ? 'pointer' : 'grab';
    });

    c.addEventListener('mouseup', (e) => {
      if (this.isDragging) {
        this.isDragging = false;
        c.style.cursor = this.hoveredNode ? 'pointer' : 'grab';

        // Check if it was a click (not a drag)
        const dx = e.clientX - this.dragStart.x - this.offsetX;
        const dy = e.clientY - this.dragStart.y - this.offsetY;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3 && this.hoveredNode) {
          this.selectedNode = this.hoveredNode;
          if (this.onNodeClick) this.onNodeClick(this.hoveredNode.data);
        }
      }
    });

    c.addEventListener('mouseleave', () => {
      this.isDragging = false;
      this.hoveredNode = null;
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.2, Math.min(3, this.scale * delta));

      // Zoom toward cursor
      this.offsetX = mx - (mx - this.offsetX) * (newScale / this.scale);
      this.offsetY = my - (my - this.offsetY) * (newScale / this.scale);
      this.scale = newScale;
    }, { passive: false });

    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width * this.dpr;
    this.canvas.height = rect.height * this.dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  _startAnimation() {
    const animate = () => {
      this.time += 0.016;
      this._draw();
      this.animFrame = requestAnimationFrame(animate);
    };
    animate();
  }

  _draw() {
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Get theme colors
    const style = getComputedStyle(document.documentElement);
    const bgColor = style.getPropertyValue('--color-bg').trim();
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    // Draw subtle grid
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    this._drawGrid(ctx, w, h);
    this._drawEdges(ctx);
    this._drawParticles(ctx);
    this._drawNodes(ctx);

    ctx.restore();

    // Draw tooltip
    if (this.hoveredNode && this.activeFilters.has(this.hoveredNode.type)) {
      this._drawTooltip(ctx, this.hoveredNode);
    }
  }

  _drawGrid(ctx, w, h) {
    const gridSize = 60;
    const startX = Math.floor((-this.offsetX / this.scale) / gridSize) * gridSize;
    const startY = Math.floor((-this.offsetY / this.scale) / gridSize) * gridSize;
    const endX = startX + w / this.scale + gridSize * 2;
    const endY = startY + h / this.scale + gridSize * 2;

    ctx.strokeStyle = 'rgba(42, 50, 66, 0.3)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = startX; x < endX; x += gridSize) {
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
    }
    for (let y = startY; y < endY; y += gridSize) {
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
    }
    ctx.stroke();
  }

  _drawEdges(ctx) {
    ctx.lineWidth = 1;
    this.edges.forEach(e => {
      const from = this.nodes[e.from];
      const to = this.nodes[e.to];
      if (!this.activeFilters.has(from.type) || !this.activeFilters.has(to.type)) return;

      ctx.strokeStyle = 'rgba(79, 152, 163, 0.12)';
      ctx.beginPath();
      // Curved edges
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2 - 20;
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(midX, midY, to.x, to.y);
      ctx.stroke();
    });
  }

  _drawParticles(ctx) {
    this.particles.forEach(p => {
      p.progress += p.speed;
      if (p.progress > 1) {
        p.progress = 0;
        p.edgeIdx = Math.floor(Math.random() * this.edges.length);
      }

      const e = this.edges[p.edgeIdx];
      if (!e) return;
      const from = this.nodes[e.from];
      const to = this.nodes[e.to];
      if (!this.activeFilters.has(from.type) || !this.activeFilters.has(to.type)) return;

      const t = p.progress;
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2 - 20;
      // Quadratic bezier point
      const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * midX + t * t * to.x;
      const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * midY + t * t * to.y;

      const alpha = Math.sin(t * Math.PI) * 0.6;
      ctx.fillStyle = `rgba(79, 152, 163, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  _drawNodes(ctx) {
    this.nodes.forEach(n => {
      if (!this.activeFilters.has(n.type)) return;
      const typeInfo = VERTEX_TYPES[n.type];
      const color = typeInfo ? typeInfo.color : '#4f98a3';
      const pulse = Math.sin(this.time * n.pulseSpeed + n.pulsePhase);

      // Glow
      const glowAlpha = 0.08 + pulse * 0.04;
      const gradient = ctx.createRadialGradient(n.x, n.y, NODE_RADIUS * 0.5, n.x, n.y, GLOW_RADIUS);
      gradient.addColorStop(0, color + Math.round(glowAlpha * 255).toString(16).padStart(2, '0'));
      gradient.addColorStop(1, color + '00');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(n.x, n.y, GLOW_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      // Node body
      const isHovered = this.hoveredNode === n;
      const isSelected = this.selectedNode === n;
      const r = NODE_RADIUS + (isHovered ? 3 : 0) + (isSelected ? 2 : 0);

      ctx.fillStyle = isSelected ? color : (n.confirmed ? color : '#333b4d');
      ctx.strokeStyle = isSelected ? '#fff' : (isHovered ? '#e0e4ec' : color + '60');
      ctx.lineWidth = isSelected ? 2 : (isHovered ? 2 : 1);

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Inner icon/letter
      ctx.fillStyle = isSelected ? '#0d0f12' : (n.confirmed ? '#0d0f12' : '#8b93a6');
      ctx.font = `600 ${9}px 'JetBrains Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const abbrev = n.type.split('_').map(w => w[0].toUpperCase()).join('');
      ctx.fillText(abbrev, n.x, n.y);

      // Unconfirmed indicator
      if (!n.confirmed) {
        ctx.strokeStyle = '#ef5350';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  }

  _drawTooltip(ctx, node) {
    const typeInfo = VERTEX_TYPES[node.type];
    const text = `${typeInfo ? typeInfo.label : node.type} • ${node.id}`;
    ctx.font = `500 11px 'Inter', sans-serif`;
    const metrics = ctx.measureText(text);
    const padding = 8;
    const w = metrics.width + padding * 2;
    const h = 28;

    const screenX = node.x * this.scale + this.offsetX;
    const screenY = node.y * this.scale + this.offsetY - NODE_RADIUS * this.scale - 12;

    ctx.fillStyle = '#1a1e26';
    ctx.strokeStyle = '#333b4d';
    ctx.lineWidth = 1;
    const r = 4;
    ctx.beginPath();
    ctx.roundRect(screenX - w / 2, screenY - h, w, h, r);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#e0e4ec';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, screenX, screenY - h / 2);
  }

  setFilters(types) {
    this.activeFilters = new Set(types);
  }

  zoomIn() {
    this.scale = Math.min(3, this.scale * 1.2);
  }

  zoomOut() {
    this.scale = Math.max(0.2, this.scale / 1.2);
  }

  resetView() {
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  getStats() {
    const visible = this.nodes.filter(n => this.activeFilters.has(n.type));
    const confirmed = visible.filter(n => n.confirmed).length;
    const tips = visible.filter(n => {
      // Tips: nodes with no children
      return !this.edges.some(e => this.nodes[e.from] === n);
    }).length;
    return {
      total: visible.length,
      confirmed,
      rate: visible.length > 0 ? ((confirmed / visible.length) * 100).toFixed(1) : '0.0',
      tips,
    };
  }

  destroy() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
  }
}
