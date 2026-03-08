/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Academia Bridge | UploadService
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Browser automation for academia.edu paper uploads using Playwright.
 *
 *  Academia.edu has NO public API. The entire upload workflow is performed via
 *  a headless Chromium browser session:
 *
 *    1. Navigate to academia.edu and sign in
 *    2. Click "Upload" button
 *    3. Select the PDF/DOCX file via file input
 *    4. Fill in title, abstract, co-authors (comma-separated), tags/keywords
 *    5. Click "Save Paper Details"
 *    6. Click "Post"
 *    7. Capture the resulting canonical paper URL
 *
 *  Error handling:
 *    - Transient failures (network, timeout) → retry with exponential backoff
 *    - Max 3 retries per paper
 *    - Credentials not configured → clear error returned, no browser launched
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { v4 as uuid } from 'uuid';
import type { DatabaseService } from './database.service.js';
import type { EventBusService } from './event-bus.service.js';
import type { PaperService } from './paper.service.js';
import type { AbUpload, UploadResult, SessionStatus } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_RETRIES          = 3;
const BASE_RETRY_DELAY_MS  = 2000;
const PAGE_TIMEOUT_MS      = 60_000;
const NAVIGATION_TIMEOUT_MS = 30_000;

const ACADEMIA_BASE_URL    = 'https://www.academia.edu';
const ACADEMIA_UPLOAD_URL  = 'https://www.academia.edu/upload';
const ACADEMIA_LOGIN_URL   = 'https://www.academia.edu/login';

// ─────────────────────────────────────────────────────────────────────────────
//  Row mapper
// ─────────────────────────────────────────────────────────────────────────────

function rowToUpload(row: Record<string, unknown>): AbUpload {
  return {
    id:           row.id as string,
    paperId:      row.paper_id as string,
    status:       row.status as AbUpload['status'],
    academiaUrl:  (row.academia_url as string | undefined) ?? undefined,
    errorMessage: (row.error_message as string | undefined) ?? undefined,
    retryCount:   row.retry_count as number,
    startedAt:    (row.started_at as Date).toISOString(),
    completedAt:  row.completed_at ? (row.completed_at as Date).toISOString() : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  UploadService
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Orchestrates paper uploads to academia.edu via Playwright browser automation.
 *
 * The service is stateless with respect to the browser: each upload attempt
 * opens a fresh browser context and closes it when done to avoid session state
 * leaking across retries.
 */
export class UploadService {
  private readonly email: string | undefined;
  private readonly password: string | undefined;
  private readonly profileName: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly eventBus: EventBusService,
    private readonly paperService: PaperService,
  ) {
    this.email       = process.env.ACADEMIA_EMAIL;
    this.password    = process.env.ACADEMIA_PASSWORD;
    this.profileName = process.env.ACADEMIA_PROFILE_NAME ?? 'Randall Gossett';
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute the full upload workflow for a paper.
   * Creates an upload record, runs the Playwright automation, and records the result.
   *
   * @param paperId - UUID of the paper to upload
   * @returns UploadResult with success/failure details
   */
  async uploadPaper(paperId: string): Promise<UploadResult> {
    // Guard: credentials must be configured
    if (!this.email || !this.password) {
      const msg = 'ACADEMIA_EMAIL and ACADEMIA_PASSWORD environment variables are required';
      console.error(`[academia-bridge] ${msg}`);
      return this._recordFailure(paperId, msg, 0);
    }

    // Guard: paper must exist
    const paper = await this.paperService.getPaper(paperId);
    if (!paper) {
      return this._recordFailure(paperId, `Paper ${paperId} not found`, 0);
    }

    // Reject if already uploaded
    if (paper.status === 'uploaded') {
      return {
        success: true,
        uploadId: '',
        academiaUrl: paper.academiaUrl,
        retryCount: 0,
      };
    }

    // Create upload record
    const uploadId = uuid();
    await this.db.query(
      `INSERT INTO academia.ab_uploads (id, paper_id, status, started_at)
       VALUES ($1, $2, 'in_progress', NOW())`,
      [uploadId, paperId],
    );

    // Transition paper to 'uploading'
    await this.paperService.setStatus(paperId, 'uploading');

    // Attempt upload with retry logic
    let lastError = '';
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      try {
        console.log(`[academia-bridge] Upload attempt ${retryCount + 1}/${MAX_RETRIES + 1} for paper ${paperId}`);

        const academiaUrl = await this._runUploadWorkflow(paper.id, paper.title, paper.abstract, paper.coAuthors, paper.tags, paper.filePath, paper.content, paper.fileType);

        // SUCCESS
        await this._recordSuccess(uploadId, paperId, academiaUrl, retryCount);
        return { success: true, uploadId, academiaUrl, retryCount };

      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error(`[academia-bridge] Upload attempt ${retryCount + 1} failed: ${lastError}`);

        retryCount++;
        if (retryCount <= MAX_RETRIES) {
          const delay = BASE_RETRY_DELAY_MS * Math.pow(2, retryCount - 1);
          console.log(`[academia-bridge] Retrying in ${delay}ms...`);
          await this._sleep(delay);
        }
      }
    }

    // All retries exhausted
    await this._recordFailure(paperId, lastError, retryCount - 1, uploadId);
    return { success: false, uploadId, errorMessage: lastError, retryCount: retryCount - 1 };
  }

  /**
   * Verify a paper is live and accessible at its academia.edu URL.
   * Performs a lightweight HTTP HEAD check (no browser required).
   *
   * @param paperId - UUID of the paper to verify
   * @returns true if the page returns HTTP 200
   */
  async checkUploadStatus(paperId: string): Promise<boolean> {
    const paper = await this.paperService.getPaper(paperId);
    if (!paper?.academiaUrl) return false;

    try {
      const resp = await fetch(paper.academiaUrl, { method: 'HEAD' });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check whether academia.edu credentials are configured.
   * Does NOT launch a browser — credentials can be validated at startup.
   *
   * @returns SessionStatus describing credential availability
   */
  getSessionStatus(): SessionStatus {
    return {
      isAuthenticated: Boolean(this.email && this.password),
      lastCheckedAt:   new Date().toISOString(),
      email:           this.email,
    };
  }

  /**
   * Get an upload record by ID.
   *
   * @param uploadId - Upload UUID
   * @returns AbUpload or null
   */
  async getUpload(uploadId: string): Promise<AbUpload | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM academia.ab_uploads WHERE id = $1`,
      [uploadId],
    );
    if (rows.length === 0) return null;
    return rowToUpload(rows[0]);
  }

  /**
   * List all upload records, most recent first.
   *
   * @param limit  - Max records to return (default 50)
   * @param offset - Pagination offset (default 0)
   * @returns Array of AbUpload objects
   */
  async listUploads(limit = 50, offset = 0): Promise<AbUpload[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM academia.ab_uploads
       ORDER BY started_at DESC
       LIMIT $1 OFFSET $2`,
      [Math.min(limit, 200), offset],
    );
    return rows.map(rowToUpload);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Private — Playwright automation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute the full browser automation workflow.
   * Opens a fresh Chromium browser context, signs in, uploads the paper,
   * and returns the canonical academia.edu URL for the published paper.
   *
   * @param paperId   - Paper UUID (for temp file naming)
   * @param title     - Paper title
   * @param abstract  - Paper abstract
   * @param coAuthors - Co-author names
   * @param tags      - Tags/keywords
   * @param filePath  - Path to existing file (optional)
   * @param content   - Raw content to write to temp file (optional)
   * @param fileType  - 'pdf' | 'docx'
   * @returns Canonical academia.edu URL for the published paper
   * @throws Error if any step fails
   */
  private async _runUploadWorkflow(
    paperId: string,
    title: string,
    abstract: string,
    coAuthors: string[],
    tags: string[],
    filePath: string | undefined,
    content: string | undefined,
    fileType: 'pdf' | 'docx',
  ): Promise<string> {
    let browser: Browser | null = null;
    let tempFilePath: string | null = null;

    try {
      // ── Resolve file path ────────────────────────────────────────────────
      let uploadFilePath: string;

      if (filePath) {
        if (!fs.existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }
        uploadFilePath = filePath;
      } else if (content) {
        // Write content to a temp file
        const tmpDir = os.tmpdir();
        const ext = fileType === 'docx' ? '.docx' : '.pdf';
        tempFilePath = path.join(tmpDir, `academia-bridge-${paperId}${ext}`);
        fs.writeFileSync(tempFilePath, content, 'utf-8');
        uploadFilePath = tempFilePath;
      } else {
        throw new Error('Paper has neither filePath nor content');
      }

      // ── Launch browser ───────────────────────────────────────────────────
      console.log('[academia-bridge] Launching Chromium browser...');
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
        ],
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport:  { width: 1280, height: 900 },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

      // ── Step 1: Sign in ──────────────────────────────────────────────────
      await this._signIn(page);

      // ── Step 2: Navigate to upload page ─────────────────────────────────
      console.log('[academia-bridge] Navigating to upload page...');
      await page.goto(ACADEMIA_UPLOAD_URL, { waitUntil: 'networkidle' });

      // Wait for the file input to appear (tries both "new upload" and "add paper" buttons)
      await this._waitForUploadInterface(page);

      // ── Step 3: Select file ──────────────────────────────────────────────
      console.log(`[academia-bridge] Selecting file: ${uploadFilePath}`);
      await this._selectFile(page, uploadFilePath);

      // Wait for the form to load after file selection
      await page.waitForSelector('input[name="title"], input[placeholder*="title" i], input[id*="title" i]', {
        timeout: 30_000,
        state: 'visible',
      });

      // ── Step 4: Fill in paper metadata ───────────────────────────────────
      console.log('[academia-bridge] Filling in paper metadata...');
      await this._fillPaperMetadata(page, title, abstract, coAuthors, tags);

      // ── Step 5: Save Paper Details ───────────────────────────────────────
      console.log('[academia-bridge] Saving paper details...');
      await this._savePaperDetails(page);

      // ── Step 6: Post the paper ───────────────────────────────────────────
      console.log('[academia-bridge] Posting paper...');
      const academiaUrl = await this._postPaper(page, title);

      console.log(`[academia-bridge] Paper published successfully: ${academiaUrl}`);
      return academiaUrl;

    } finally {
      if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
      }
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Sign in to academia.edu.
   * Navigates to the login page, fills credentials, and waits for the
   * authenticated state (presence of user menu or profile link).
   */
  private async _signIn(page: Page): Promise<void> {
    console.log('[academia-bridge] Signing in to academia.edu...');

    await page.goto(ACADEMIA_LOGIN_URL, { waitUntil: 'networkidle' });

    // Handle cookie consent if present
    try {
      const cookieBtn = page.locator('button:has-text("Accept"), button:has-text("I Accept"), button[id*="accept" i]').first();
      if (await cookieBtn.isVisible({ timeout: 3000 })) {
        await cookieBtn.click();
      }
    } catch { /* cookie banner not present */ }

    // Fill email
    const emailField = page.locator(
      'input[type="email"], input[name="email"], input[placeholder*="email" i]'
    ).first();
    await emailField.waitFor({ state: 'visible' });
    await emailField.fill(this.email!);

    // Fill password
    const passwordField = page.locator(
      'input[type="password"], input[name="password"], input[placeholder*="password" i]'
    ).first();
    await passwordField.fill(this.password!);

    // Submit login form
    const submitBtn = page.locator(
      'button[type="submit"], input[type="submit"], button:has-text("Sign In"), button:has-text("Log In"), button:has-text("Login")'
    ).first();
    await submitBtn.click();

    // Wait for successful authentication — look for user-specific UI elements
    await page.waitForFunction(() => {
      return (
        document.querySelector('[data-testid="user-menu"]') !== null ||
        document.querySelector('.navbar-avatar') !== null ||
        document.querySelector('[class*="avatar"]') !== null ||
        document.querySelector('[href*="/me"]') !== null ||
        document.querySelector('a[href*="logout"]') !== null ||
        document.title.toLowerCase().includes('feed') ||
        window.location.pathname === '/' ||
        window.location.pathname.startsWith('/feed')
      );
    }, { timeout: 30_000 });

    console.log('[academia-bridge] Sign-in successful');
  }

  /**
   * Wait for the upload interface to be ready.
   * Academia.edu's upload UI may be a modal, a dedicated page, or a wizard.
   */
  private async _waitForUploadInterface(page: Page): Promise<void> {
    // Look for various upload triggers: button, link, or the file input directly
    try {
      const uploadTrigger = page.locator(
        'button:has-text("Upload"), a:has-text("Upload Paper"), [data-testid*="upload" i]'
      ).first();
      if (await uploadTrigger.isVisible({ timeout: 5000 })) {
        await uploadTrigger.click();
      }
    } catch { /* direct upload page, no trigger needed */ }

    // Wait for the file input to be available
    await page.waitForSelector(
      'input[type="file"], [data-testid="file-upload"], [class*="file-upload" i]',
      { state: 'attached', timeout: 20_000 },
    );
  }

  /**
   * Select the file for upload using the file input element.
   * Uses Playwright's `setInputFiles` for reliable file selection without
   * triggering system dialogs.
   */
  private async _selectFile(page: Page, filePath: string): Promise<void> {
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);

    // Wait for upload progress to complete or for the form to advance
    await page.waitForFunction(() => {
      const progressBars = document.querySelectorAll('[class*="progress" i], [role="progressbar"]');
      if (progressBars.length === 0) return true; // no progress bar means we moved on
      // Check if progress bar is gone or at 100%
      for (const bar of progressBars) {
        const text = (bar as HTMLElement).innerText ?? '';
        const ariaValue = (bar as HTMLElement).getAttribute('aria-valuenow');
        if (text.includes('100') || ariaValue === '100') return true;
      }
      return false;
    }, { timeout: 60_000 });

    // Brief pause to allow react state to settle
    await page.waitForTimeout(1000);
  }

  /**
   * Fill in the paper metadata form fields.
   *
   * Academia.edu's upload form has these fields:
   *   - Title (text input)
   *   - Abstract (textarea)
   *   - Co-authors (comma-separated text input or tag input)
   *   - Keywords/tags (comma-separated text input or tag input)
   */
  private async _fillPaperMetadata(
    page: Page,
    title: string,
    abstract: string,
    coAuthors: string[],
    tags: string[],
  ): Promise<void> {
    // ── Title ──────────────────────────────────────────────────────────────
    const titleInput = page.locator(
      'input[name="title"], input[id*="title" i], input[placeholder*="title" i], input[class*="title" i]'
    ).first();
    await titleInput.waitFor({ state: 'visible' });
    await titleInput.clear();
    await titleInput.fill(title);

    // ── Abstract ───────────────────────────────────────────────────────────
    const abstractInput = page.locator(
      'textarea[name="abstract"], textarea[id*="abstract" i], textarea[placeholder*="abstract" i], [contenteditable][data-field*="abstract" i]'
    ).first();
    try {
      await abstractInput.waitFor({ state: 'visible', timeout: 5000 });
      await abstractInput.clear();
      await abstractInput.fill(abstract);
    } catch {
      // abstract might not be required on first step
      console.log('[academia-bridge] Abstract field not visible, skipping');
    }

    // ── Co-authors ─────────────────────────────────────────────────────────
    if (coAuthors.length > 0) {
      const coAuthorInput = page.locator(
        'input[name*="co_author" i], input[id*="co-author" i], input[id*="coauthor" i], input[placeholder*="co-author" i], input[placeholder*="author" i]'
      ).first();
      try {
        await coAuthorInput.waitFor({ state: 'visible', timeout: 5000 });
        await coAuthorInput.clear();
        await coAuthorInput.fill(coAuthors.join(', '));
      } catch {
        console.log('[academia-bridge] Co-author field not visible, skipping');
      }
    }

    // ── Tags / Keywords ────────────────────────────────────────────────────
    if (tags.length > 0) {
      const tagInput = page.locator(
        'input[name*="tag" i], input[id*="tag" i], input[id*="keyword" i], input[placeholder*="keyword" i], input[placeholder*="tag" i]'
      ).first();
      try {
        await tagInput.waitFor({ state: 'visible', timeout: 5000 });
        await tagInput.clear();
        await tagInput.fill(tags.join(', '));

        // Some tag inputs require pressing Enter for each tag
        for (const tag of tags) {
          await tagInput.clear();
          await tagInput.fill(tag);
          await tagInput.press('Enter');
          await page.waitForTimeout(300);
        }
      } catch {
        console.log('[academia-bridge] Tag field not visible, skipping');
      }
    }
  }

  /**
   * Click the "Save Paper Details" button and wait for confirmation.
   */
  private async _savePaperDetails(page: Page): Promise<void> {
    const saveBtn = page.locator(
      'button:has-text("Save Paper Details"), button:has-text("Save Details"), button:has-text("Next"), input[value*="Save" i]'
    ).first();
    await saveBtn.waitFor({ state: 'visible' });
    await saveBtn.click();

    // Wait for the page to advance to the post step
    await page.waitForFunction(() => {
      const body = document.body.innerText ?? '';
      return (
        body.includes('Post') ||
        body.includes('Publish') ||
        body.includes('Share') ||
        document.querySelector('button[class*="post" i]') !== null
      );
    }, { timeout: 20_000 });
  }

  /**
   * Click the "Post" button and capture the resulting paper URL.
   *
   * After posting, academia.edu typically redirects to the canonical paper page.
   * We capture this URL and verify it looks like a valid academia.edu paper URL.
   */
  private async _postPaper(page: Page, title: string): Promise<string> {
    const postBtn = page.locator(
      'button:has-text("Post"), button:has-text("Publish"), button:has-text("Share"), input[value*="Post" i]'
    ).first();
    await postBtn.waitFor({ state: 'visible' });

    // Click and wait for navigation
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60_000 }),
      postBtn.click(),
    ]);

    // Capture the URL
    const currentUrl = page.url();

    // Validate it looks like an academia.edu paper page
    if (currentUrl.includes('academia.edu') && !currentUrl.includes('/upload') && !currentUrl.includes('/login')) {
      return currentUrl;
    }

    // If we didn't navigate away cleanly, try to find the paper URL on the page
    const canonicalLink = page.locator('link[rel="canonical"]');
    const canonical = await canonicalLink.getAttribute('href').catch(() => null);
    if (canonical?.includes('academia.edu')) {
      return canonical;
    }

    // Look for a link with the paper title
    const titleSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
    const paperLink = page.locator(`a[href*="${titleSlug}"]`).first();
    const href = await paperLink.getAttribute('href').catch(() => null);
    if (href) {
      return href.startsWith('http') ? href : `${ACADEMIA_BASE_URL}${href}`;
    }

    // Fallback — return current URL even if it doesn't match pattern
    console.warn(`[academia-bridge] Could not capture canonical URL, using: ${currentUrl}`);
    return currentUrl;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Private — database helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Record a successful upload — updates both the upload record and the paper.
   */
  private async _recordSuccess(
    uploadId: string,
    paperId: string,
    academiaUrl: string,
    retryCount: number,
  ): Promise<void> {
    await this.db.query(
      `UPDATE academia.ab_uploads
       SET status = 'success', academia_url = $1, retry_count = $2, completed_at = NOW()
       WHERE id = $3`,
      [academiaUrl, retryCount, uploadId],
    );

    await this.paperService.setStatus(paperId, 'uploaded', academiaUrl);

    console.log(`[academia-bridge] Upload ${uploadId} succeeded: ${academiaUrl}`);
  }

  /**
   * Record a failed upload — updates both the upload record and the paper.
   * If no uploadId is provided (credential guard failures), creates a new record.
   */
  private async _recordFailure(
    paperId: string,
    errorMessage: string,
    retryCount: number,
    uploadId?: string,
  ): Promise<UploadResult> {
    const id = uploadId ?? uuid();

    if (!uploadId) {
      await this.db.query(
        `INSERT INTO academia.ab_uploads (id, paper_id, status, error_message, retry_count, started_at, completed_at)
         VALUES ($1, $2, 'failed', $3, $4, NOW(), NOW())`,
        [id, paperId, errorMessage, retryCount],
      );
    } else {
      await this.db.query(
        `UPDATE academia.ab_uploads
         SET status = 'failed', error_message = $1, retry_count = $2, completed_at = NOW()
         WHERE id = $3`,
        [errorMessage, retryCount, uploadId],
      );
    }

    await this.paperService.setStatus(paperId, 'failed');

    console.error(`[academia-bridge] Upload ${id} failed after ${retryCount} retries: ${errorMessage}`);

    return { success: false, uploadId: id, errorMessage, retryCount };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Private — utilities
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Async sleep helper for retry delays.
   * @param ms - Milliseconds to wait
   */
  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
