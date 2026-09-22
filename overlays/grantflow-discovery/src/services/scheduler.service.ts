/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GrantFlow Discovery — Scheduler Service
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Manages periodic autonomous grant discovery cycles.
 *
 *  Default schedule: every 6 hours (configurable via DISCOVERY_INTERVAL_MS env var)
 *
 *  Each discovery cycle:
 *    1. Search Grants.gov for open/forecasted grants matching profile keywords
 *    2. Persist new/updated opportunities to the database
 *    3. Compute match scores for each opportunity against all profiles
 *    4. Emit Extropy Engine claims for:
 *         - New discoveries (grant.discovered)
 *         - High-scoring new matches (grant.matched)
 *    5. Record the search run in gf_search_runs
 *
 *  The scheduler uses setInterval for simplicity. It can be upgraded to
 *  integrate with the Temporal service for more robust scheduling.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { v4 as uuid } from 'uuid';
import type { DatabaseService } from './database.service.js';
import type { GrantsGovService } from './grants-gov.service.js';
import type { ProfileService } from './profile.service.js';
import type { MatchingService } from './matching.service.js';
import type { ClaimService } from './claim.service.js';
import type { GfSearchRun } from '../types/index.js';

/** Default discovery cycle interval: 6 hours */
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1_000;

/** Match score threshold above which we emit a discovery claim */
const CLAIM_SCORE_THRESHOLD = 40;

/** Keywords to search per cycle (rotated to stay within rate limits) */
const SEARCH_KEYWORD_SETS: string[] = [
  'entropy information theory IoT',
  'decentralized systems smart home',
  'thermodynamic computation distributed',
  'autonomous systems edge computing',
  'blockchain sensor networks energy efficiency',
  'information entropy IoT internet of things',
  'machine learning embedded systems',
  'digital twins building automation',
];

export class SchedulerService {
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastRunAt: string | null = null;
  private currentKeywordIndex = 0;

  constructor(
    private readonly db:          DatabaseService,
    private readonly grantsGov:   GrantsGovService,
    private readonly profileSvc:  ProfileService,
    private readonly matching:    MatchingService,
    private readonly claims:      ClaimService,
    private readonly intervalMs:  number = DEFAULT_INTERVAL_MS,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start the discovery scheduler.
   * Runs an initial discovery cycle immediately, then schedules subsequent
   * runs at the configured interval.
   */
  start(): void {
    if (this.intervalHandle) {
      console.log('[scheduler] Already running — ignoring start()');
      return;
    }

    console.log(
      `[scheduler] Starting — interval=${this.intervalMs / 60_000}min`,
    );

    // Run immediately on startup (with a small delay to let services initialise)
    setTimeout(() => {
      this.runDiscoveryCycle().catch(err => {
        console.error('[scheduler] Initial discovery cycle failed:', err);
      });
    }, 5_000);

    // Then schedule recurring runs
    this.intervalHandle = setInterval(() => {
      this.runDiscoveryCycle().catch(err => {
        console.error('[scheduler] Scheduled discovery cycle failed:', err);
      });
    }, this.intervalMs);

    console.log('[scheduler] Scheduler started');
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      console.log('[scheduler] Scheduler stopped');
    }
  }

  /**
   * Returns true if the scheduler is currently active.
   */
  isActive(): boolean {
    return this.intervalHandle !== null;
  }

  /**
   * Returns the ISO-8601 timestamp of the last completed run.
   */
  getLastRunAt(): string | null {
    return this.lastRunAt;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Discovery Cycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute a full grant discovery cycle:
   *  search → persist → match → claim
   *
   * This method is idempotent: if a cycle is already running it returns
   * immediately to prevent overlapping runs.
   *
   * @param keyword - Optional override keyword (uses rotating set if not provided)
   * @returns GfSearchRun record
   */
  async runDiscoveryCycle(keyword?: string): Promise<GfSearchRun> {
    if (this.isRunning) {
      console.log('[scheduler] Cycle already in progress — skipping');
      // Return the most recent run from the database
      const { rows } = await this.db.query(
        'SELECT * FROM gf_search_runs ORDER BY executed_at DESC LIMIT 1',
      );
      if (rows.length > 0) return this.rowToSearchRun(rows[0]);

      return this.buildPlaceholderRun('Skipped — cycle in progress');
    }

    this.isRunning = true;
    const startedAt = Date.now();
    const runId     = uuid();
    let resultsCount  = 0;
    let matchesFound  = 0;
    let claimsEmitted = 0;
    let errorMessage: string | undefined;

    // Rotate keywords
    const query = keyword ?? SEARCH_KEYWORD_SETS[this.currentKeywordIndex % SEARCH_KEYWORD_SETS.length];
    this.currentKeywordIndex++;

    console.log(`[scheduler] Discovery cycle started — query="${query}"`);

    try {
      // ── 1. Search Grants.gov ──────────────────────────────────────────
      const opportunities = await this.grantsGov.searchGrants({
        keyword:    query,
        oppStatuses: 'forecasted|posted',
        rows:       25,
        sortBy:     'openDate|desc',
      });

      resultsCount = opportunities.length;
      console.log(`[scheduler] Found ${resultsCount} opportunities`);

      // ── 2. Persist opportunities ──────────────────────────────────────
      const persisted = await Promise.all(
        opportunities.map(opp => this.grantsGov.persistOpportunity(opp)),
      );

      // ── 3. Get all profiles for matching ─────────────────────────────
      const profiles = await this.profileSvc.listProfiles(100);

      if (profiles.length === 0) {
        console.warn('[scheduler] No profiles found — ensuring default profile exists');
        await this.profileSvc.ensureDefaultProfile();
      }

      const allProfiles = await this.profileSvc.listProfiles(100);

      // ── 4. Match opportunities against all profiles ───────────────────
      for (const opp of persisted) {
        for (const profile of allProfiles) {
          const match = await this.matching.matchOpportunityToProfile(opp, profile);

          if (match) {
            matchesFound++;

            // Only emit claims for high-scoring new matches
            if (match.score >= CLAIM_SCORE_THRESHOLD) {
              // Discovery claim
              await this.claims.emitDiscoveryClaim(opp);
              claimsEmitted++;

              // Match claim
              await this.claims.emitMatchClaim(match);
              claimsEmitted++;
            }
          }
        }
      }

      console.log(
        `[scheduler] Cycle complete — results=${resultsCount} matches=${matchesFound} claims=${claimsEmitted}`,
      );
    } catch (err) {
      errorMessage = (err as Error).message;
      console.error('[scheduler] Discovery cycle error:', err);
    } finally {
      this.isRunning  = false;
      this.lastRunAt  = new Date().toISOString();
    }

    // ── 5. Record the search run ──────────────────────────────────────────
    const durationMs = Date.now() - startedAt;
    const success    = !errorMessage;

    await this.db.query(
      `INSERT INTO gf_search_runs (
        id, query, results_count, matches_found, claims_emitted,
        success, error_message, duration_ms, executed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        runId,
        query,
        resultsCount,
        matchesFound,
        claimsEmitted,
        success,
        errorMessage ?? null,
        durationMs,
      ],
    );

    return {
      id:            runId,
      query,
      resultsCount,
      matchesFound,
      claimsEmitted,
      success,
      errorMessage,
      durationMs,
      executedAt:    this.lastRunAt ?? new Date().toISOString(),
    };
  }

  /**
   * Get recent search run history.
   *
   * @param limit - Max records to return (default 20)
   */
  async getSearchHistory(limit = 20): Promise<GfSearchRun[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM gf_search_runs ORDER BY executed_at DESC LIMIT $1',
      [limit],
    );
    return rows.map(r => this.rowToSearchRun(r));
  }

  /**
   * Get the next scheduled run time (approximate, based on last run + interval).
   */
  getNextRunAt(): string | null {
    if (!this.lastRunAt) return null;
    const next = new Date(
      new Date(this.lastRunAt).getTime() + this.intervalMs,
    );
    return next.toISOString();
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Private Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private rowToSearchRun(row: Record<string, unknown>): GfSearchRun {
    return {
      id:            row['id'] as string,
      query:         row['query'] as string,
      resultsCount:  Number(row['results_count']),
      matchesFound:  Number(row['matches_found']),
      claimsEmitted: Number(row['claims_emitted']),
      success:       row['success'] as boolean,
      errorMessage:  row['error_message'] as string | undefined,
      durationMs:    Number(row['duration_ms']),
      executedAt:    (row['executed_at'] as Date).toISOString(),
    };
  }

  private buildPlaceholderRun(reason: string): GfSearchRun {
    return {
      id:            uuid(),
      query:         '',
      resultsCount:  0,
      matchesFound:  0,
      claimsEmitted: 0,
      success:       false,
      errorMessage:  reason,
      durationMs:    0,
      executedAt:    new Date().toISOString(),
    };
  }
}
