/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Academia Bridge | MetricsService
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Track paper performance metrics by scraping the public academia.edu
 *  paper page. Metrics are cached in `academia.ab_metrics` and refreshed
 *  on demand or via the scheduler endpoint.
 *
 *  Collected metrics:
 *    - views     — total page view count
 *    - downloads — total download count
 *    - citations — citation count (if available)
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { chromium } from 'playwright';
import type { DatabaseService } from './database.service.js';
import type { PaperService } from './paper.service.js';
import type { AbMetrics, AggregateMetrics } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Row mapper
// ─────────────────────────────────────────────────────────────────────────────

function rowToMetrics(row: Record<string, unknown>): AbMetrics {
  return {
    paperId:      row.paper_id as string,
    academiaUrl:  row.academia_url as string,
    views:        row.views as number,
    downloads:    row.downloads as number,
    citations:    row.citations as number,
    lastSyncedAt: (row.last_synced_at as Date).toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  MetricsService
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches and caches view/download metrics from academia.edu paper pages.
 *
 * Academia.edu renders metrics client-side; a headless browser is required
 * to extract these numbers. Metrics are upserted into `academia.ab_metrics`.
 */
export class MetricsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly paperService: PaperService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Scrape and cache view/download counts from the paper's academia.edu page.
   * Uses a headless browser (Playwright) to render the JavaScript-driven page.
   *
   * @param paperId - UUID of the uploaded paper
   * @returns Updated AbMetrics, or null if the paper has no academia URL
   */
  async syncMetrics(paperId: string): Promise<AbMetrics | null> {
    const paper = await this.paperService.getPaper(paperId);
    if (!paper?.academiaUrl) {
      console.warn(`[academia-bridge] Cannot sync metrics for ${paperId}: no academiaUrl`);
      return null;
    }

    console.log(`[academia-bridge] Syncing metrics for paper ${paperId}: ${paper.academiaUrl}`);

    let views     = 0;
    let downloads = 0;
    let citations = 0;

    try {
      const scraped = await this._scrapeMetrics(paper.academiaUrl);
      views     = scraped.views;
      downloads = scraped.downloads;
      citations = scraped.citations;
    } catch (err) {
      console.error(`[academia-bridge] Metrics scrape failed for ${paperId}:`, err);
      // Return cached metrics rather than propagating error
      return this.getMetrics(paperId);
    }

    // Upsert metrics
    const { rows } = await this.db.query<Record<string, unknown>>(
      `INSERT INTO academia.ab_metrics (paper_id, academia_url, views, downloads, citations, last_synced_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (paper_id) DO UPDATE SET
         academia_url   = EXCLUDED.academia_url,
         views          = EXCLUDED.views,
         downloads      = EXCLUDED.downloads,
         citations      = EXCLUDED.citations,
         last_synced_at = NOW()
       RETURNING *`,
      [paperId, paper.academiaUrl, views, downloads, citations],
    );

    const metrics = rowToMetrics(rows[0]);
    console.log(`[academia-bridge] Metrics synced for ${paperId}: views=${views}, downloads=${downloads}`);
    return metrics;
  }

  /**
   * Get cached metrics for a paper.
   * Returns null if no metrics have been synced yet.
   *
   * @param paperId - UUID of the paper
   * @returns Cached AbMetrics or null
   */
  async getMetrics(paperId: string): Promise<AbMetrics | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM academia.ab_metrics WHERE paper_id = $1`,
      [paperId],
    );
    if (rows.length === 0) return null;
    return rowToMetrics(rows[0]);
  }

  /**
   * Compute aggregate metrics across all uploaded papers.
   * Totals all views, downloads, and citations from the `ab_metrics` cache.
   *
   * @returns AggregateMetrics summary
   */
  async getAggregateMetrics(): Promise<AggregateMetrics> {
    // Total papers uploaded
    const { rows: paperRows } = await this.db.query<Record<string, unknown>>(
      `SELECT COUNT(*) as total FROM academia.ab_papers WHERE status = 'uploaded'`,
    );
    const totalPapers = parseInt(String(paperRows[0].total ?? '0'), 10);

    // Aggregate views/downloads/citations
    const { rows: aggRows } = await this.db.query<Record<string, unknown>>(
      `SELECT
         COALESCE(SUM(views), 0)     as total_views,
         COALESCE(SUM(downloads), 0) as total_downloads,
         COALESCE(SUM(citations), 0) as total_citations,
         MAX(last_synced_at)         as last_synced_at
       FROM academia.ab_metrics`,
    );

    const agg = aggRows[0];
    return {
      totalPapers,
      totalViews:      parseInt(String(agg.total_views ?? '0'), 10),
      totalDownloads:  parseInt(String(agg.total_downloads ?? '0'), 10),
      totalCitations:  parseInt(String(agg.total_citations ?? '0'), 10),
      lastSyncedAt:    agg.last_synced_at ? (agg.last_synced_at as Date).toISOString() : null,
    };
  }

  /**
   * Sync metrics for all uploaded papers in the database.
   * This is intended to be called by the scheduler endpoint (`POST /api/v1/scheduler/sync`).
   *
   * Processes papers sequentially to avoid overwhelming academia.edu.
   *
   * @returns Array of updated AbMetrics (null entries for papers that failed to sync)
   */
  async syncAllMetrics(): Promise<(AbMetrics | null)[]> {
    // Get all uploaded papers that have an academia URL
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id FROM academia.ab_papers WHERE status = 'uploaded' AND academia_url IS NOT NULL`,
    );

    console.log(`[academia-bridge] Syncing metrics for ${rows.length} papers...`);

    const results: (AbMetrics | null)[] = [];
    for (const row of rows) {
      const metrics = await this.syncMetrics(row.id as string);
      results.push(metrics);
      // Rate limiting: brief pause between requests
      await this._sleep(1500);
    }

    console.log(`[academia-bridge] Metrics sync complete: ${results.filter(Boolean).length}/${rows.length} successful`);
    return results;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Private — browser scraping
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Launch a headless browser and extract view/download counts from the
   * academia.edu paper page.
   *
   * Academia.edu renders these numbers in elements like:
   *   `<span class="js-view-count">1,234</span>`
   *   `<span data-download-count="567">`
   *
   * The selectors are best-effort — the page structure may change.
   * Falls back to 0 for any metric that cannot be found.
   */
  private async _scrapeMetrics(url: string): Promise<{
    views: number;
    downloads: number;
    citations: number;
  }> {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);

      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

      // Wait briefly for JavaScript to populate counts
      await page.waitForTimeout(2000);

      // Extract metrics using multiple selector strategies
      const views     = await this._extractNumber(page, [
        '[class*="view-count"]',
        '[data-view-count]',
        '.js-view-count',
        '[itemprop="interactionCount"]',
      ]);

      const downloads = await this._extractNumber(page, [
        '[class*="download-count"]',
        '[data-download-count]',
        '.js-download-count',
        'a[href*="download"] span',
      ]);

      const citations = await this._extractNumber(page, [
        '[class*="citation-count"]',
        '[data-citation-count]',
        '.js-citation-count',
        '[itemprop="citation"]',
      ]);

      return { views, downloads, citations };

    } finally {
      await browser.close();
    }
  }

  /**
   * Try each selector in order and return the first non-zero number found.
   * Returns 0 if no selector matches or the content is not a parseable number.
   */
  private async _extractNumber(
    page: import('playwright').Page,
    selectors: string[],
  ): Promise<number> {
    for (const selector of selectors) {
      try {
        const el = page.locator(selector).first();
        if (!await el.isVisible({ timeout: 500 })) continue;

        // Check data attribute first
        const dataAttr = await el.getAttribute('data-count') ??
                         await el.getAttribute('data-view-count') ??
                         await el.getAttribute('data-download-count') ??
                         await el.getAttribute('content');

        const text = dataAttr ?? await el.innerText();
        const num = this._parseCount(text);
        if (num > 0) return num;
      } catch { /* selector not found, try next */ }
    }
    return 0;
  }

  /**
   * Parse a localized count string to an integer.
   * Handles commas, spaces, and shorthand like "1.2k" or "2.5K".
   */
  private _parseCount(text: string): number {
    if (!text) return 0;
    const clean = text.trim().replace(/,/g, '').replace(/\s/g, '');

    // Handle shorthand (1.2k, 2.5K, 3M)
    const shorthand = /^([\d.]+)([kKmM])$/.exec(clean);
    if (shorthand) {
      const value = parseFloat(shorthand[1]);
      const mult  = shorthand[2].toLowerCase() === 'k' ? 1000 :
                    shorthand[2].toLowerCase() === 'm' ? 1_000_000 : 1;
      return Math.round(value * mult);
    }

    const num = parseInt(clean, 10);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Async sleep helper.
   */
  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
