// Mock data for AcademicXP demo/dev builds
// Falls back to this data when Extropy Engine APIs are unavailable

export type ReviewerTier = "Novice" | "Apprentice" | "Specialist" | "Expert" | "Master" | "Pioneer";

export interface Manuscript {
  id: string;
  title: string;
  authors: string[];
  domain: string;
  status: "submitted" | "ai_review" | "peer_review" | "consensus" | "published" | "rejected";
  fidelityScore: number;
  submittedAt: string;
  abstract: string;
  aiPreReview?: AIPreReview;
}

export interface AIPreReview {
  technicalAccuracy: number;
  methodology: number;
  novelty: number;
  reproducibility: number;
  overallScore: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  plagiarismCheck: { score: number; status: "clear" | "flagged" };
  fraudDetection: { score: number; status: "clear" | "flagged" };
}

export interface Reviewer {
  id: string;
  name: string;
  xp: number;
  tier: ReviewerTier;
  domains: string[];
  reviewsCompleted: number;
  avgQuality: number;
  joinedAt: string;
  avatar?: string;
}

export interface PendingReview {
  id: string;
  manuscriptId: string;
  manuscriptTitle: string;
  domain: string;
  deadline: string;
  priority: "low" | "medium" | "high" | "urgent";
  estimatedTime: string;
}

export interface XPTransaction {
  id: string;
  amount: number;
  reason: string;
  manuscriptId?: string;
  timestamp: string;
  type: "review" | "bonus" | "streak" | "quality" | "consensus";
}

export interface LeaderboardEntry {
  rank: number;
  reviewer: Reviewer;
  domainXP: number;
  seasonReviews: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  earnedAt: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
}

// ─── Manuscripts ───────────────────────────────────────────────

export const mockManuscripts: Manuscript[] = [
  {
    id: "ms-001",
    title: "Quantum Entanglement Signatures in Room-Temperature Superconductors",
    authors: ["Dr. Sarah Chen", "Prof. Michael Torres", "Dr. Aisha Patel"],
    domain: "Physics",
    status: "peer_review",
    fidelityScore: 0.87,
    submittedAt: "2025-01-15T10:30:00Z",
    abstract: "We present experimental evidence for quantum entanglement signatures persisting at room temperature in a novel hydrogen-rich superconducting material. Using nitrogen-vacancy center magnetometry and neutron scattering, we identify coherent entanglement patterns that correlate with the onset of superconductivity at 293K under 180 GPa.",
    aiPreReview: {
      technicalAccuracy: 94,
      methodology: 91,
      novelty: 96,
      reproducibility: 88,
      overallScore: 92,
      summary: "Strong experimental methodology with novel claims. High significance if reproducible. Minor concerns about pressure calibration methodology.",
      strengths: [
        "Novel approach combining NV-center magnetometry with neutron scattering",
        "Comprehensive statistical analysis with Monte Carlo error propagation",
        "Clear documentation of experimental parameters and conditions",
      ],
      weaknesses: [
        "Pressure calibration relies on a single ruby fluorescence standard",
        "Limited to one sample composition — broader material survey needed",
        "Theoretical model assumptions need stronger justification",
      ],
      plagiarismCheck: { score: 98.7, status: "clear" },
      fraudDetection: { score: 96.2, status: "clear" },
    },
  },
  {
    id: "ms-002",
    title: "Transformer Architectures for Protein Folding Prediction Beyond AlphaFold",
    authors: ["Dr. James Liu", "Elena Vasquez"],
    domain: "CompSci",
    status: "ai_review",
    fidelityScore: 0.82,
    submittedAt: "2025-01-18T14:22:00Z",
    abstract: "We introduce ProteinFormer-X, a novel transformer architecture that extends beyond AlphaFold's evoformer module by incorporating multi-scale geometric attention and thermodynamic stability priors. Our model achieves 2.3% improvement in GDT-TS on CASP16 free-modeling targets while requiring 40% fewer parameters.",
    aiPreReview: {
      technicalAccuracy: 89,
      methodology: 93,
      novelty: 91,
      reproducibility: 90,
      overallScore: 91,
      summary: "Well-structured computational study with clear improvements over baseline. Reproducibility is strong with code and data availability.",
      strengths: [
        "Clear ablation studies isolating contribution of each module",
        "Code and model weights available for reproducibility",
        "Strong baseline comparisons across multiple datasets",
      ],
      weaknesses: [
        "GDT-TS improvement is marginal — need additional metrics",
        "Training cost comparison with AlphaFold3 missing",
        "Limited evaluation on multi-chain complexes",
      ],
      plagiarismCheck: { score: 99.1, status: "clear" },
      fraudDetection: { score: 97.4, status: "clear" },
    },
  },
  {
    id: "ms-003",
    title: "CRISPR-Cas13d Mediated RNA Editing in Neurodegenerative Disease Models",
    authors: ["Dr. Maria Santos", "Prof. Robert Kim", "Dr. Yuki Tanaka", "Dr. Felix Weber"],
    domain: "Biology",
    status: "consensus",
    fidelityScore: 0.93,
    submittedAt: "2025-01-10T08:15:00Z",
    abstract: "We demonstrate targeted RNA editing using engineered Cas13d variants in iPSC-derived neurons carrying ALS-associated FUS mutations. Our approach achieves 78% editing efficiency with minimal off-target effects, restoring normal FUS protein localization and reducing stress granule formation by 65%.",
    aiPreReview: {
      technicalAccuracy: 96,
      methodology: 95,
      novelty: 88,
      reproducibility: 92,
      overallScore: 93,
      summary: "Exceptional methodology with clinically relevant results. Strong experimental design with appropriate controls.",
      strengths: [
        "Rigorous iPSC differentiation protocol with characterization",
        "Multiple orthogonal assays confirming editing outcomes",
        "Dose-response and time-course data included",
      ],
      weaknesses: [
        "Only one ALS mutation tested — generalizability uncertain",
        "In vivo data would strengthen clinical translation argument",
      ],
      plagiarismCheck: { score: 99.4, status: "clear" },
      fraudDetection: { score: 98.1, status: "clear" },
    },
  },
  {
    id: "ms-004",
    title: "Non-Commutative Geometry Approaches to the Riemann Hypothesis",
    authors: ["Prof. André Laurent"],
    domain: "Mathematics",
    status: "peer_review",
    fidelityScore: 0.79,
    submittedAt: "2025-01-20T16:45:00Z",
    abstract: "We develop a novel framework connecting Connes' non-commutative geometry program to the distribution of Riemann zeta zeros. By constructing an explicit spectral realization of the zeros as eigenvalues of a self-adjoint operator on a non-commutative space, we provide new partial results toward RH for specific families of L-functions.",
    aiPreReview: {
      technicalAccuracy: 93,
      methodology: 87,
      novelty: 95,
      reproducibility: 72,
      overallScore: 87,
      summary: "Highly novel approach with deep mathematical content. Verification requires specialist expertise. Some proof steps need additional detail.",
      strengths: [
        "Innovative connection between operator algebras and number theory",
        "Builds coherently on Connes-Marcolli framework",
        "Numerical verification for first 10 million zeros",
      ],
      weaknesses: [
        "Key lemma (Lemma 4.7) proof sketch needs expansion",
        "Connection to full RH remains conjectural",
        "Notation inconsistencies in Sections 3 and 5",
      ],
      plagiarismCheck: { score: 99.8, status: "clear" },
      fraudDetection: { score: 95.5, status: "clear" },
    },
  },
  {
    id: "ms-005",
    title: "Metal-Organic Framework Catalysts for Ambient CO₂ Reduction to Methanol",
    authors: ["Dr. Priya Sharma", "Dr. Hans Mueller", "Prof. Lisa Zhang"],
    domain: "Chemistry",
    status: "published",
    fidelityScore: 0.95,
    submittedAt: "2024-12-28T11:00:00Z",
    abstract: "We report a bimetallic Cu-Zn MOF catalyst (CZMOF-7) achieving 92% faradaic efficiency for CO₂ electroreduction to methanol at ambient temperature and pressure. In situ XANES and DRIFTS spectroscopy reveal a synergistic mechanism involving Cu(I) sites for CO₂ activation and Zn(II) sites for proton relay.",
    aiPreReview: {
      technicalAccuracy: 95,
      methodology: 96,
      novelty: 90,
      reproducibility: 94,
      overallScore: 94,
      summary: "Outstanding experimental work with clear mechanistic insights. Highly reproducible with detailed synthesis protocols.",
      strengths: [
        "Exceptional faradaic efficiency exceeds prior benchmarks",
        "Comprehensive in situ spectroscopic characterization",
        "Scalability demonstrated at 100cm² electrode",
      ],
      weaknesses: [
        "Long-term stability data limited to 100 hours",
        "Cost analysis of MOF synthesis at scale missing",
      ],
      plagiarismCheck: { score: 99.6, status: "clear" },
      fraudDetection: { score: 99.0, status: "clear" },
    },
  },
  {
    id: "ms-006",
    title: "Soft Robotic Exoskeletons with Distributed Strain Sensing for Gait Rehabilitation",
    authors: ["Dr. Kevin Park", "Dr. Olivia Martinez"],
    domain: "Engineering",
    status: "submitted",
    fidelityScore: 0.0,
    submittedAt: "2025-01-22T09:30:00Z",
    abstract: "We present a pneumatically-actuated soft robotic exoskeleton incorporating a distributed network of stretchable capacitive strain sensors for real-time gait analysis and adaptive torque assistance. Clinical trials with 24 post-stroke patients demonstrate 34% improvement in walking speed and 28% reduction in metabolic cost.",
  },
  {
    id: "ms-007",
    title: "Bayesian Neural Networks for Uncertainty Quantification in Climate Projections",
    authors: ["Dr. Rachel Green", "Prof. David Okonkwo", "Dr. Mei-Li Wang"],
    domain: "CompSci",
    status: "peer_review",
    fidelityScore: 0.85,
    submittedAt: "2025-01-12T13:10:00Z",
    abstract: "We apply scalable Bayesian deep learning to CMIP7 ensemble outputs, producing calibrated uncertainty estimates for regional temperature and precipitation projections through 2100. Our method decomposes total uncertainty into aleatoric (irreducible) and epistemic (model) components, enabling more informative policy guidance.",
    aiPreReview: {
      technicalAccuracy: 91,
      methodology: 94,
      novelty: 87,
      reproducibility: 93,
      overallScore: 91,
      summary: "Solid methodological contribution with practical relevance. Clear presentation and strong validation.",
      strengths: [
        "Principled uncertainty decomposition with clear interpretation",
        "Validated against held-out CMIP7 models",
        "Open-source implementation with documentation",
      ],
      weaknesses: [
        "Computational cost scaling not fully characterized",
        "Limited evaluation at sub-regional scales",
      ],
      plagiarismCheck: { score: 99.2, status: "clear" },
      fraudDetection: { score: 97.8, status: "clear" },
    },
  },
];

// ─── Reviewers ────────────────────────────────────────────────

export const mockReviewers: Reviewer[] = [
  { id: "rev-001", name: "Dr. Eleanor Vance", xp: 24750, tier: "Master", domains: ["Physics", "Mathematics"], reviewsCompleted: 156, avgQuality: 94.2, joinedAt: "2023-03-15" },
  { id: "rev-002", name: "Prof. Marcus Webb", xp: 31200, tier: "Pioneer", domains: ["CompSci", "Engineering"], reviewsCompleted: 203, avgQuality: 96.1, joinedAt: "2022-11-01" },
  { id: "rev-003", name: "Dr. Fatima Al-Rashid", xp: 18400, tier: "Expert", domains: ["Biology", "Chemistry"], reviewsCompleted: 112, avgQuality: 92.8, joinedAt: "2023-06-22" },
  { id: "rev-004", name: "Dr. Hiroshi Nakamura", xp: 22100, tier: "Master", domains: ["Physics", "Engineering"], reviewsCompleted: 145, avgQuality: 93.5, joinedAt: "2023-01-10" },
  { id: "rev-005", name: "Prof. Isabella Rossi", xp: 28900, tier: "Pioneer", domains: ["Mathematics", "CompSci"], reviewsCompleted: 189, avgQuality: 95.7, joinedAt: "2022-09-05" },
  { id: "rev-006", name: "Dr. Thomas Okafor", xp: 15200, tier: "Expert", domains: ["Biology"], reviewsCompleted: 98, avgQuality: 91.4, joinedAt: "2023-08-14" },
  { id: "rev-007", name: "Dr. Sophie Laurent", xp: 12800, tier: "Specialist", domains: ["Chemistry", "Biology"], reviewsCompleted: 76, avgQuality: 90.1, joinedAt: "2023-11-20" },
  { id: "rev-008", name: "Dr. Raj Patel", xp: 8900, tier: "Specialist", domains: ["CompSci"], reviewsCompleted: 52, avgQuality: 88.6, joinedAt: "2024-02-01" },
  { id: "rev-009", name: "Dr. Anna Kowalski", xp: 5600, tier: "Apprentice", domains: ["Physics"], reviewsCompleted: 28, avgQuality: 85.3, joinedAt: "2024-05-15" },
  { id: "rev-010", name: "Maya Chen", xp: 2100, tier: "Novice", domains: ["Engineering", "CompSci"], reviewsCompleted: 11, avgQuality: 82.7, joinedAt: "2024-09-01" },
  { id: "rev-011", name: "Dr. Luca Bianchi", xp: 19600, tier: "Expert", domains: ["Mathematics", "Physics"], reviewsCompleted: 127, avgQuality: 93.0, joinedAt: "2023-04-18" },
  { id: "rev-012", name: "Dr. Emily Watson", xp: 10300, tier: "Specialist", domains: ["Chemistry"], reviewsCompleted: 64, avgQuality: 89.4, joinedAt: "2024-01-08" },
];

// ─── Current User (demo) ──────────────────────────────────────

export const mockCurrentUser: Reviewer = mockReviewers[3]; // Dr. Hiroshi Nakamura

// ─── Pending Reviews ──────────────────────────────────────────

export const mockPendingReviews: PendingReview[] = [
  {
    id: "pr-001",
    manuscriptId: "ms-001",
    manuscriptTitle: "Quantum Entanglement Signatures in Room-Temperature Superconductors",
    domain: "Physics",
    deadline: "2025-02-01T23:59:00Z",
    priority: "high",
    estimatedTime: "3-4 hours",
  },
  {
    id: "pr-002",
    manuscriptId: "ms-004",
    manuscriptTitle: "Non-Commutative Geometry Approaches to the Riemann Hypothesis",
    domain: "Mathematics",
    deadline: "2025-02-05T23:59:00Z",
    priority: "medium",
    estimatedTime: "5-6 hours",
  },
  {
    id: "pr-003",
    manuscriptId: "ms-007",
    manuscriptTitle: "Bayesian Neural Networks for Uncertainty Quantification in Climate Projections",
    domain: "CompSci",
    deadline: "2025-02-10T23:59:00Z",
    priority: "low",
    estimatedTime: "2-3 hours",
  },
];

// ─── XP Transactions ──────────────────────────────────────────

export const mockXPTransactions: XPTransaction[] = [
  { id: "xp-001", amount: 450, reason: "Review: CRISPR-Cas13d RNA Editing", manuscriptId: "ms-003", timestamp: "2025-01-21T16:00:00Z", type: "review" },
  { id: "xp-002", amount: 120, reason: "Quality bonus — 95th percentile review", timestamp: "2025-01-21T16:01:00Z", type: "quality" },
  { id: "xp-003", amount: 380, reason: "Review: MOF Catalysts for CO₂ Reduction", manuscriptId: "ms-005", timestamp: "2025-01-19T10:30:00Z", type: "review" },
  { id: "xp-004", amount: 200, reason: "7-day review streak bonus", timestamp: "2025-01-18T00:00:00Z", type: "streak" },
  { id: "xp-005", amount: 520, reason: "Review: Transformer Protein Folding", manuscriptId: "ms-002", timestamp: "2025-01-16T14:45:00Z", type: "review" },
  { id: "xp-006", amount: 75, reason: "Consensus achieved — entropy reduction bonus", timestamp: "2025-01-15T11:20:00Z", type: "consensus" },
  { id: "xp-007", amount: 410, reason: "Review: Bayesian Climate Projections", manuscriptId: "ms-007", timestamp: "2025-01-13T09:00:00Z", type: "review" },
  { id: "xp-008", amount: 300, reason: "Monthly domain expertise bonus", timestamp: "2025-01-01T00:00:00Z", type: "bonus" },
  { id: "xp-009", amount: 490, reason: "Review: Soft Robotic Exoskeletons", manuscriptId: "ms-006", timestamp: "2024-12-29T15:30:00Z", type: "review" },
  { id: "xp-010", amount: 150, reason: "5-day review streak bonus", timestamp: "2024-12-27T00:00:00Z", type: "streak" },
];

// ─── XP Over Time (for chart) ─────────────────────────────────

export const mockXPHistory = [
  { month: "Aug 24", xp: 14200 },
  { month: "Sep 24", xp: 15800 },
  { month: "Oct 24", xp: 17400 },
  { month: "Nov 24", xp: 18900 },
  { month: "Dec 24", xp: 20500 },
  { month: "Jan 25", xp: 22100 },
];

// ─── Leaderboard by Domain ────────────────────────────────────

export function getMockLeaderboard(domain?: string): LeaderboardEntry[] {
  let reviewers = [...mockReviewers];
  if (domain && domain !== "All") {
    reviewers = reviewers.filter((r) => r.domains.includes(domain));
  }
  return reviewers
    .sort((a, b) => b.xp - a.xp)
    .map((reviewer, index) => ({
      rank: index + 1,
      reviewer,
      domainXP: domain && domain !== "All"
        ? Math.round(reviewer.xp * (0.5 + Math.random() * 0.4))
        : reviewer.xp,
      seasonReviews: Math.round(reviewer.reviewsCompleted * 0.3),
    }));
}

// ─── Achievements ─────────────────────────────────────────────

export const mockAchievements: Achievement[] = [
  { id: "ach-001", name: "First Review", description: "Complete your first peer review", icon: "star", earnedAt: "2023-01-15", rarity: "common" },
  { id: "ach-002", name: "Century Club", description: "Complete 100 peer reviews", icon: "award", earnedAt: "2024-08-20", rarity: "rare" },
  { id: "ach-003", name: "Consensus Builder", description: "Achieve consensus on 50 manuscripts", icon: "users", earnedAt: "2024-06-10", rarity: "uncommon" },
  { id: "ach-004", name: "Multi-Domain", description: "Review in 3+ scientific domains", icon: "globe", earnedAt: "2024-03-22", rarity: "uncommon" },
  { id: "ach-005", name: "Quality Guardian", description: "Maintain 93%+ average review quality", icon: "shield", earnedAt: "2024-11-05", rarity: "rare" },
  { id: "ach-006", name: "Streak Master", description: "Maintain a 30-day review streak", icon: "flame", earnedAt: "2024-09-15", rarity: "epic" },
  { id: "ach-007", name: "Expert Ascendant", description: "Reach Expert tier", icon: "trending-up", earnedAt: "2024-04-01", rarity: "uncommon" },
  { id: "ach-008", name: "Master Scholar", description: "Reach Master tier", icon: "crown", earnedAt: "2025-01-10", rarity: "rare" },
];

// ─── Domain expertise breakdown ───────────────────────────────

export const mockDomainExpertise = [
  { domain: "Physics", score: 92, reviews: 58 },
  { domain: "Mathematics", score: 85, reviews: 42 },
  { domain: "Engineering", score: 78, reviews: 31 },
  { domain: "CompSci", score: 65, reviews: 14 },
  { domain: "Chemistry", score: 30, reviews: 0 },
  { domain: "Biology", score: 20, reviews: 0 },
];

// ─── Platform Stats ───────────────────────────────────────────

export const mockPlatformStats = {
  totalManuscripts: 1247,
  activeReviewers: 892,
  consensusRate: 91,
  avgSatisfaction: 4.6,
};

// ─── Tier thresholds ──────────────────────────────────────────

export const tierThresholds: Record<ReviewerTier, { min: number; max: number; color: string }> = {
  Novice: { min: 0, max: 3000, color: "gray" },
  Apprentice: { min: 3000, max: 8000, color: "green" },
  Specialist: { min: 8000, max: 15000, color: "blue" },
  Expert: { min: 15000, max: 25000, color: "purple" },
  Master: { min: 25000, max: 40000, color: "amber" },
  Pioneer: { min: 40000, max: 100000, color: "indigo" },
};

export const allDomains = ["Physics", "CompSci", "Biology", "Mathematics", "Chemistry", "Engineering"];
