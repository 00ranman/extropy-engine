// API wrapper — tries real Extropy Engine endpoints, falls back to mock data
import { apiRequest } from "@/lib/queryClient";
import {
  mockManuscripts,
  mockCurrentUser,
  mockPendingReviews,
  mockXPTransactions,
  mockXPHistory,
  getMockLeaderboard,
  mockAchievements,
  mockDomainExpertise,
  mockPlatformStats,
  type Manuscript,
  type Reviewer,
  type PendingReview,
  type XPTransaction,
  type LeaderboardEntry,
  type Achievement,
} from "@/lib/mockData";

async function tryApi<T>(method: string, url: string, fallback: T, body?: unknown): Promise<T> {
  try {
    const res = await apiRequest(method, url, body);
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

// ─── Manuscripts ──────────────────────────────────────────────

export async function fetchManuscripts(): Promise<Manuscript[]> {
  return tryApi("GET", "/api/manuscripts", mockManuscripts);
}

export async function fetchManuscript(id: string): Promise<Manuscript | undefined> {
  const fallback = mockManuscripts.find((m) => m.id === id);
  return tryApi("GET", `/api/manuscripts/${id}`, fallback);
}

export async function submitManuscript(data: {
  title: string;
  authors: string[];
  domain: string;
  abstract: string;
}): Promise<{ id: string; status: string }> {
  return tryApi("POST", "/api/claims", { id: `ms-${Date.now()}`, status: "submitted" }, data);
}

// ─── Reviews ──────────────────────────────────────────────────

export async function submitReview(data: {
  manuscriptId: string;
  ratings: Record<string, number>;
  strengths: string;
  weaknesses: string;
  suggestions: string;
  thermodynamicAnchor?: {
    baseline: string;
    expectedOutcome: string;
    measurementMethod: string;
  };
}): Promise<{ id: string; xpEarned: number }> {
  return tryApi("POST", "/api/validations", { id: `val-${Date.now()}`, xpEarned: 420 }, data);
}

export async function fetchPendingReviews(): Promise<PendingReview[]> {
  return tryApi("GET", "/api/reviews/pending", mockPendingReviews);
}

// ─── XP ───────────────────────────────────────────────────────

export async function fetchXP(userId: string): Promise<{
  total: number;
  transactions: XPTransaction[];
  history: typeof mockXPHistory;
}> {
  return tryApi("GET", `/api/xp/${userId}`, {
    total: mockCurrentUser.xp,
    transactions: mockXPTransactions,
    history: mockXPHistory,
  });
}

// ─── Leaderboard ──────────────────────────────────────────────

export async function fetchLeaderboard(domain?: string): Promise<LeaderboardEntry[]> {
  const fallback = getMockLeaderboard(domain);
  const url = domain && domain !== "All" ? `/api/leaderboard?domain=${domain}` : "/api/leaderboard";
  return tryApi("GET", url, fallback);
}

// ─── Credentials ──────────────────────────────────────────────

export async function fetchCredentials(userId: string): Promise<{
  user: Reviewer;
  achievements: Achievement[];
  domainExpertise: typeof mockDomainExpertise;
}> {
  return tryApi("GET", `/api/credentials/${userId}`, {
    user: mockCurrentUser,
    achievements: mockAchievements,
    domainExpertise: mockDomainExpertise,
  });
}

// ─── Platform Stats ───────────────────────────────────────────

export async function fetchPlatformStats() {
  return tryApi("GET", "/api/stats", mockPlatformStats);
}
