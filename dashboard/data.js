// data.js — All mock data for the XP Dashboard

// ================================================
// VERTEX TYPES AND COLORS
// ================================================
export const VERTEX_TYPES = {
  loop_open:        { label: 'Loop Open',        color: '#4f98a3', badge: 'teal' },
  measurement:      { label: 'Measurement',      color: '#42a5f5', badge: 'blue' },
  xp_mint:          { label: 'XP Mint',          color: '#d19900', badge: 'gold' },
  governance_vote:  { label: 'Gov Vote',         color: '#ab47bc', badge: 'purple' },
  dfao_created:     { label: 'DFAO Created',     color: '#4caf50', badge: 'success' },
  loop_close:       { label: 'Loop Close',       color: '#26c6da', badge: 'teal' },
  validator_assign: { label: 'Validator Assign',  color: '#5c6bc0', badge: 'blue' },
  credential_issue: { label: 'Credential Issue', color: '#ec407a', badge: 'error' },
  season_start:     { label: 'Season Start',     color: '#9ccc65', badge: 'success' },
  decay_apply:      { label: 'Decay Apply',      color: '#ef5350', badge: 'error' },
  token_transfer:   { label: 'Token Transfer',   color: '#ff9800', badge: 'warning' },
  claim_submit:     { label: 'Claim Submit',     color: '#4f98a3', badge: 'teal' },
};

// ================================================
// DAG VERTICES (85 vertices)
// ================================================
function generateVertices() {
  const types = Object.keys(VERTEX_TYPES);
  const vertices = [];
  const now = Date.now();
  const hour = 3600000;

  const names = [
    'Implemented caching layer reducing API latency by 340ms',
    'Trained model achieving 94% accuracy on sentiment analysis',
    'Deployed solar panel array yielding 12kW additional capacity',
    'Reduced database query time from 2.3s to 180ms',
    'Established community garden serving 40 households',
    'Published peer-reviewed study on urban heat islands',
    'Created open-source library with 2.3k GitHub stars',
    'Optimized logistics route saving 23% fuel costs',
    'Developed curriculum reaching 500+ students',
    'Installed water filtration system for 200 residents',
    'Built real-time monitoring dashboard for air quality',
    'Reduced energy consumption by 18% through smart HVAC',
    'Designed modular housing prototype at 60% reduced cost',
    'Created mesh network covering 5km rural area',
    'Developed composting system processing 2 tons/week',
  ];

  for (let i = 0; i < 85; i++) {
    const type = types[Math.floor(Math.random() * types.length)];
    const ts = now - Math.floor(Math.random() * 72 * hour);
    const parents = [];
    if (i > 2) {
      const numParents = Math.min(Math.floor(Math.random() * 3), i);
      const used = new Set();
      for (let j = 0; j < numParents; j++) {
        let p = Math.floor(Math.random() * i);
        while (used.has(p)) p = Math.floor(Math.random() * i);
        used.add(p);
        parents.push(`v_${String(p).padStart(4, '0')}`);
      }
    }

    vertices.push({
      id: `v_${String(i).padStart(4, '0')}`,
      type,
      timestamp: ts,
      parents,
      confirmed: Math.random() > 0.12,
      claim: type === 'loop_open' || type === 'claim_submit'
        ? names[Math.floor(Math.random() * names.length)]
        : null,
      deltaS: type === 'measurement' || type === 'xp_mint'
        ? +(Math.random() * 2).toFixed(3)
        : null,
      xpAmount: type === 'xp_mint' ? +(Math.random() * 500 + 50).toFixed(1) : null,
      actor: `0x${Math.random().toString(16).slice(2, 10)}`,
    });
  }
  return vertices;
}

export const dagVertices = generateVertices();

// ================================================
// LOOPS (18 loops)
// ================================================
export const loops = [
  { id: 'L-4782', claim: 'Implemented caching layer reducing API latency by 340ms', domain: 'Software Engineering', status: 'closed', deltaS: 0.847, xpMinted: 423.5, validators: ['Alice Chen', 'Bob Nakamura', 'Carlos Reyes'], openedAt: '2026-02-20T10:30:00Z', closedAt: '2026-02-25T16:45:00Z' },
  { id: 'L-4783', claim: 'Trained ML model achieving 94% accuracy on sentiment', domain: 'Data Science', status: 'measuring', deltaS: null, xpMinted: null, validators: ['Diana Okafor', 'Eve Zhang'], openedAt: '2026-02-26T08:15:00Z', closedAt: null },
  { id: 'L-4784', claim: 'Deployed solar array yielding 12kW additional capacity', domain: 'Renewable Energy', status: 'validating', deltaS: 1.240, xpMinted: null, validators: ['Frank Kim', 'Grace Liu', 'Hiro Tanaka'], openedAt: '2026-02-24T14:00:00Z', closedAt: null },
  { id: 'L-4785', claim: 'Reduced DB query time from 2.3s to 180ms', domain: 'Software Engineering', status: 'closed', deltaS: 1.542, xpMinted: 771.0, validators: ['Alice Chen', 'Ivan Petrov'], openedAt: '2026-02-18T09:00:00Z', closedAt: '2026-02-22T11:30:00Z' },
  { id: 'L-4786', claim: 'Established community garden serving 40 households', domain: 'Community Building', status: 'open', deltaS: null, xpMinted: null, validators: [], openedAt: '2026-02-28T07:30:00Z', closedAt: null },
  { id: 'L-4787', claim: 'Published peer-reviewed urban heat island study', domain: 'Climate Science', status: 'closed', deltaS: 0.963, xpMinted: 481.5, validators: ['Julia Santos', 'Kevin Wang', 'Lina Müller'], openedAt: '2026-02-15T12:00:00Z', closedAt: '2026-02-20T18:00:00Z' },
  { id: 'L-4788', claim: 'Created OSS library with 2.3k GitHub stars', domain: 'Software Engineering', status: 'failed', deltaS: 0.112, xpMinted: null, validators: ['Bob Nakamura', 'Carlos Reyes'], openedAt: '2026-02-22T10:00:00Z', closedAt: '2026-02-27T09:00:00Z' },
  { id: 'L-4789', claim: 'Optimized logistics route saving 23% fuel costs', domain: 'Supply Chain', status: 'closed', deltaS: 1.087, xpMinted: 543.5, validators: ['Diana Okafor', 'Eve Zhang', 'Frank Kim'], openedAt: '2026-02-17T11:00:00Z', closedAt: '2026-02-21T15:30:00Z' },
  { id: 'L-4790', claim: 'Developed curriculum reaching 500+ students', domain: 'Education', status: 'measuring', deltaS: null, xpMinted: null, validators: ['Grace Liu'], openedAt: '2026-02-27T09:45:00Z', closedAt: null },
  { id: 'L-4791', claim: 'Installed water filtration for 200 residents', domain: 'Public Health', status: 'validating', deltaS: 1.680, xpMinted: null, validators: ['Hiro Tanaka', 'Ivan Petrov', 'Julia Santos'], openedAt: '2026-02-23T08:00:00Z', closedAt: null },
  { id: 'L-4792', claim: 'Built real-time air quality monitoring dashboard', domain: 'Environmental Monitoring', status: 'open', deltaS: null, xpMinted: null, validators: [], openedAt: '2026-02-28T14:20:00Z', closedAt: null },
  { id: 'L-4793', claim: 'Reduced energy consumption by 18% via smart HVAC', domain: 'Energy Efficiency', status: 'closed', deltaS: 0.754, xpMinted: 377.0, validators: ['Kevin Wang', 'Lina Müller'], openedAt: '2026-02-19T13:00:00Z', closedAt: '2026-02-24T10:00:00Z' },
  { id: 'L-4794', claim: 'Designed modular housing at 60% reduced cost', domain: 'Architecture', status: 'measuring', deltaS: null, xpMinted: null, validators: ['Alice Chen', 'Bob Nakamura', 'Carlos Reyes'], openedAt: '2026-02-26T16:00:00Z', closedAt: null },
  { id: 'L-4795', claim: 'Created mesh network covering 5km rural area', domain: 'Telecommunications', status: 'closed', deltaS: 1.320, xpMinted: 660.0, validators: ['Diana Okafor', 'Eve Zhang'], openedAt: '2026-02-16T10:30:00Z', closedAt: '2026-02-21T14:00:00Z' },
  { id: 'L-4796', claim: 'Developed composting system processing 2 tons/week', domain: 'Waste Management', status: 'open', deltaS: null, xpMinted: null, validators: [], openedAt: '2026-02-28T11:00:00Z', closedAt: null },
  { id: 'L-4797', claim: 'Automated CI/CD pipeline reducing deploy time 80%', domain: 'DevOps', status: 'failed', deltaS: 0.043, xpMinted: null, validators: ['Frank Kim'], openedAt: '2026-02-25T09:00:00Z', closedAt: '2026-02-28T12:00:00Z' },
  { id: 'L-4798', claim: 'Launched neighborhood mutual aid network', domain: 'Community Building', status: 'validating', deltaS: 0.892, xpMinted: null, validators: ['Grace Liu', 'Hiro Tanaka'], openedAt: '2026-02-25T14:00:00Z', closedAt: null },
  { id: 'L-4799', claim: 'Designed permaculture food forest for 2 hectares', domain: 'Agriculture', status: 'open', deltaS: null, xpMinted: null, validators: [], openedAt: '2026-03-01T08:00:00Z', closedAt: null },
];

// ================================================
// TOKEN BALANCES
// ================================================
export const tokens = [
  { symbol: 'XP',  name: 'Experience Points',     desc: 'Non-transferable',    balance: 42847.25, color: '#d19900', bg: 'var(--color-gold-highlight)',  change: '+1,247', trend: [38200, 39100, 39800, 40500, 41200, 41900, 42847] },
  { symbol: 'CT',  name: 'Cross-Platform Token',   desc: 'Transferable utility', balance: 8420.00,  color: '#4f98a3', bg: 'var(--color-primary-highlight)', change: '+320', trend: [7200, 7500, 7800, 7900, 8100, 8300, 8420] },
  { symbol: 'CAT', name: 'Certification Token',    desc: 'Skill credentials',   balance: 15,       color: '#ab47bc', bg: 'var(--color-purple-highlight)', change: '+2', trend: [8, 9, 10, 11, 12, 13, 15] },
  { symbol: 'IT',  name: 'Influence Token',        desc: 'Governance weight',   balance: 2340.50,  color: '#5c6bc0', bg: 'var(--color-blue-highlight)',   change: '+180', trend: [1800, 1900, 2000, 2100, 2150, 2250, 2340] },
  { symbol: 'DT',  name: 'Domain Token',           desc: 'Domain expertise',    balance: 6,        color: '#4caf50', bg: 'var(--color-success-highlight)', change: '+1', trend: [3, 3, 4, 4, 5, 5, 6] },
  { symbol: 'EP',  name: 'Exchange Points',        desc: 'Merchant loyalty',    balance: 1250.75,  color: '#ff9800', bg: 'var(--color-warning-highlight)', change: '+450', trend: [400, 550, 700, 850, 950, 1100, 1250] },
];

// ================================================
// RECENT MINTS
// ================================================
export const recentMints = [
  { id: 'M-1201', loopId: 'L-4782', amount: 423.5, R: 0.92, F: 1.15, deltaS: 0.847, wE: 0.88, Ts: 0.72, timestamp: '2026-02-25T16:45:00Z' },
  { id: 'M-1200', loopId: 'L-4785', amount: 771.0, R: 0.98, F: 1.30, deltaS: 1.542, wE: 0.95, Ts: 0.85, timestamp: '2026-02-22T11:30:00Z' },
  { id: 'M-1199', loopId: 'L-4795', amount: 660.0, R: 0.95, F: 1.20, deltaS: 1.320, wE: 0.91, Ts: 0.78, timestamp: '2026-02-21T15:30:00Z' },
  { id: 'M-1198', loopId: 'L-4789', amount: 543.5, R: 0.90, F: 1.10, deltaS: 1.087, wE: 0.87, Ts: 0.80, timestamp: '2026-02-21T14:00:00Z' },
  { id: 'M-1197', loopId: 'L-4787', amount: 481.5, R: 0.88, F: 1.18, deltaS: 0.963, wE: 0.84, Ts: 0.76, timestamp: '2026-02-20T18:00:00Z' },
  { id: 'M-1196', loopId: 'L-4793', amount: 377.0, R: 0.85, F: 1.05, deltaS: 0.754, wE: 0.82, Ts: 0.70, timestamp: '2026-02-24T10:00:00Z' },
];

// ================================================
// DFAOs (8 with 3 levels nesting)
// ================================================
export const dfaos = [
  {
    id: 'D-001', name: 'Global Entropy Alliance', scale: 'global', status: 'active', members: 12847, reputation: 9.2,
    children: [
      {
        id: 'D-002', name: 'North America Climate Network', scale: 'regional', status: 'active', members: 3420, reputation: 8.7,
        children: [
          { id: 'D-005', name: 'Bay Area Clean Tech', scale: 'local', status: 'active', members: 287, reputation: 8.1, children: [] },
          { id: 'D-006', name: 'NYC Urban Resilience', scale: 'local', status: 'hybrid', members: 412, reputation: 7.8, children: [] },
        ]
      },
      {
        id: 'D-003', name: 'European Sustainability Collective', scale: 'regional', status: 'active', members: 4200, reputation: 8.9,
        children: [
          { id: 'D-007', name: 'Berlin Energy Transition', scale: 'local', status: 'active', members: 523, reputation: 8.3, children: [] },
          { id: 'D-008', name: 'Amsterdam Circular Economy', scale: 'local', status: 'shadow', members: 145, reputation: 6.2, children: [] },
        ]
      },
      {
        id: 'D-004', name: 'Asia-Pacific Innovation Hub', scale: 'regional', status: 'hybrid', members: 5227, reputation: 8.5,
        children: [
          { id: 'D-009', name: 'Tokyo Quantum Lab', scale: 'micro', status: 'active', members: 42, reputation: 9.1, children: [] },
          { id: 'D-010', name: 'Singapore Smart City', scale: 'local', status: 'active', members: 380, reputation: 8.0, children: [] },
        ]
      },
    ]
  },
];

// ================================================
// GOVERNANCE PROPOSALS
// ================================================
export const proposals = [
  { id: 'P-042', title: 'Increase validator quorum to 5 for high-value loops', desc: 'Loops with projected XP > 500 should require 5 validators instead of 3 to ensure measurement quality.', status: 'active', votesFor: 2847, votesAgainst: 1203, quorum: 5000, totalVoters: 4050, timeRemaining: '2d 14h', author: 'Alice Chen', createdAt: '2026-02-26T10:00:00Z' },
  { id: 'P-041', title: 'Add "Urban Agriculture" as new entropy domain', desc: 'Proposal to formally recognize Urban Agriculture as an 8th entropy domain with dedicated validators and measurement criteria.', status: 'active', votesFor: 3421, votesAgainst: 892, quorum: 5000, totalVoters: 4313, timeRemaining: '5d 2h', author: 'Carlos Reyes', createdAt: '2026-02-24T15:30:00Z' },
  { id: 'P-040', title: 'Reduce seasonal decay from 5% to 3%', desc: 'The current 5% monthly decay is too aggressive for part-time contributors. Proposal to reduce to 3%.', status: 'passed', votesFor: 4521, votesAgainst: 479, quorum: 5000, totalVoters: 5000, timeRemaining: null, author: 'Eve Zhang', createdAt: '2026-02-15T08:00:00Z' },
  { id: 'P-039', title: 'Implement cross-DFAO reputation portability', desc: 'Allow reputation scores to be partially portable across DFAOs with a 20% haircut on transfer.', status: 'passed', votesFor: 3890, votesAgainst: 1110, quorum: 5000, totalVoters: 5000, timeRemaining: null, author: 'Grace Liu', createdAt: '2026-02-10T12:00:00Z' },
  { id: 'P-038', title: 'Ban automated measurement submissions', desc: 'Require human attestation for all entropy measurements to prevent gaming via bots.', status: 'rejected', votesFor: 1200, votesAgainst: 3800, quorum: 5000, totalVoters: 5000, timeRemaining: null, author: 'Kevin Wang', createdAt: '2026-02-05T09:00:00Z' },
];

// ================================================
// REPUTATION
// ================================================
export const reputation = {
  level: 7,
  title: 'Ecosystem Pioneer',
  xpToNextLevel: 8500,
  currentXpInLevel: 6200,
  domains: [
    { name: 'Software Engineering', score: 8.4 },
    { name: 'Data Science',         score: 6.2 },
    { name: 'Climate Science',      score: 5.8 },
    { name: 'Community Building',   score: 7.1 },
    { name: 'Renewable Energy',     score: 4.3 },
    { name: 'Education',            score: 6.9 },
    { name: 'Public Health',        score: 3.7 },
    { name: 'Supply Chain',         score: 5.5 },
  ],
  badges: [
    { name: 'First Loop',       icon: '🔄', color: '#4f98a3', earned: '2025-06-15' },
    { name: '100 XP',           icon: '⚡', color: '#d19900', earned: '2025-07-02' },
    { name: 'Validator',        icon: '✓',  color: '#4caf50', earned: '2025-08-10' },
    { name: '1K XP',            icon: '🏆', color: '#d19900', earned: '2025-09-22' },
    { name: 'Multi-Domain',     icon: '🌐', color: '#42a5f5', earned: '2025-11-05' },
    { name: 'Season Survivor',  icon: '❄️', color: '#26c6da', earned: '2025-12-01' },
    { name: 'Gov Participant',  icon: '🗾️', color: '#ab47bc', earned: '2026-01-15' },
    { name: '10K XP',           icon: '💎', color: '#d19900', earned: '2026-02-01' },
    { name: 'DFAO Founder',     icon: '🏛️', color: '#5c6bc0', earned: '2026-02-14' },
    { name: 'Pioneer',          icon: '🚀', color: '#ec407a', earned: '2026-02-20' },
  ],
};

// ================================================
// SEASONS
// ================================================
export const seasons = [
  { id: 'S-003', name: 'Season 3: Emergence', startDate: '2026-02-01', endDate: '2026-04-30', status: 'active', decayRate: 0.05, totalXpMinted: 124580, activeLoops: 23, closedLoops: 187 },
  { id: 'S-002', name: 'Season 2: Foundation', startDate: '2025-11-01', endDate: '2026-01-31', status: 'completed', decayRate: 0.05, totalXpMinted: 98420, activeLoops: 0, closedLoops: 312 },
  { id: 'S-001', name: 'Season 1: Genesis', startDate: '2025-08-01', endDate: '2025-10-31', status: 'completed', decayRate: 0.05, totalXpMinted: 67230, activeLoops: 0, closedLoops: 198 },
];

// ================================================
// ECOSYSTEM APPS
// ================================================
export const ecosystemApps = [
  { id: 'app-1', name: 'LevelUp Academy', icon: '📚', color: '#42a5f5', desc: 'Skill development platform with XP-integrated courses, certifications, and mentorship tracks.', status: 'active', port: 4014 },
  { id: 'app-2', name: 'SignalFlow', icon: '📡', color: '#4f98a3', desc: 'Real-time task routing to validators. Matches entropy claims with domain experts.', status: 'active', port: 4002 },
  { id: 'app-3', name: 'HomeFlow', icon: '🏠', color: '#4caf50', desc: 'Household entropy reduction tracker. Monitor energy, waste, and resource optimization.', status: 'active', port: 4014 },
  { id: 'app-4', name: 'Merchant Network', icon: '🏪', color: '#ff9800', desc: 'Spend EP tokens at participating merchants. Local-first commerce with entropy incentives.', status: 'coming_soon', port: 4012 },
  { id: 'app-5', name: 'Re:Coherence', icon: '🧠', color: '#ab47bc', desc: 'Mental coherence and wellbeing protocol. Guided entropy reduction for personal growth.', status: 'coming_soon', port: null },
];

// ================================================
// BACKEND SERVICES
// ================================================
export const services = [
  { name: 'epistemology-engine', port: 4001, status: 'online', purpose: 'Claims, Bayesian truth scoring' },
  { name: 'signalflow',         port: 4002, status: 'online', purpose: 'Task routing to validators' },
  { name: 'loop-ledger',        port: 4003, status: 'online', purpose: 'DAG-based loop lifecycle' },
  { name: 'reputation',         port: 4004, status: 'online', purpose: 'Validator reputation vectors' },
  { name: 'xp-mint',            port: 4005, status: 'online', purpose: 'XP minting on loop closure' },
  { name: 'dag-substrate',      port: 4008, status: 'online', purpose: 'Permissionless DAG ledger' },
  { name: 'dfao-registry',      port: 4009, status: 'online', purpose: 'DFAO CRUD, fractal nesting' },
  { name: 'governance',         port: 4010, status: 'degraded', purpose: 'Proposals, voting, parameters' },
  { name: 'temporal',           port: 4011, status: 'online', purpose: 'Seasons, timeouts, decay' },
  { name: 'token-economy',      port: 4012, status: 'online', purpose: 'CT/CAT/IT/DT/EP tokens' },
  { name: 'credentials',        port: 4013, status: 'offline', purpose: 'Levels, badges, titles' },
  { name: 'ecosystem',          port: 4014, status: 'online', purpose: 'Skill DAG, XP Oracle, exchange' },
];

// ================================================
// DECAY DATA (monthly)
// ================================================
export const decayHistory = [
  { month: 'Sep 2025', startXP: 12400, decayed: 620, endXP: 11780 },
  { month: 'Oct 2025', startXP: 15800, decayed: 790, endXP: 15010 },
  { month: 'Nov 2025', startXP: 19200, decayed: 960, endXP: 18240 },
  { month: 'Dec 2025', startXP: 24100, decayed: 1205, endXP: 22895 },
  { month: 'Jan 2026', startXP: 31500, decayed: 1575, endXP: 29925 },
  { month: 'Feb 2026', startXP: 38200, decayed: 1910, endXP: 36290 },
];

// ================================================
// HELPER: Format timestamp
// ================================================
export function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatNumber(n) {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return String(n);
}
