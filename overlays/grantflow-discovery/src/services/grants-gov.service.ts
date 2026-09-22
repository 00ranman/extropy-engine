/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GrantFlow Discovery — Grants.gov API Service
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Handles all communication with the Grants.gov APIs:
 *
 *  1. REST API (v2) — no authentication required
 *     POST https://api.grants.gov/v2/opportunities/search   (search)
 *     GET  https://api.grants.gov/v2/opportunities/{id}     (detail)
 *
 *  2. S2S SOAP API — requires AOR credentials & certificates (optional)
 *     POST https://apply07.grants.gov/grantsws/services/v2/ApplicantWebServicesSoapPort
 *
 *  Features:
 *  - Automatic retry with exponential back-off on 429 / 5xx
 *  - Maps raw API responses to internal GfOpportunity type
 *  - Persists discovered opportunities to the database
 *  - Rate limiting awareness (Grants.gov allows ~60 req/min unauthenticated)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { v4 as uuid } from 'uuid';
import type { DatabaseService } from './database.service.js';
import type {
  GfOpportunity,
  GfSearchParams,
  GrantsGovOpportunity,
  GrantsGovSearchResponse,
  GrantsGovS2SCredentials,
} from '../types/index.js';

// ── Constants ──────────────────────────────────────────────────────────────

const GRANTS_GOV_BASE_URL  = 'https://api.grants.gov/v2';
const GRANTS_GOV_SOAP_URL  = 'https://apply07.grants.gov/grantsws/services/v2/ApplicantWebServicesSoapPort';
const DEFAULT_RETRY_COUNT  = 3;
const RETRY_BASE_DELAY_MS  = 1_000;
const REQUEST_TIMEOUT_MS   = 30_000;

// ─────────────────────────────────────────────────────────────────────────────

export class GrantsGovService {
  constructor(private readonly db: DatabaseService) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  REST API — Search
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Search Grants.gov for open/forecasted opportunities matching the given
   * parameters. Automatically handles retries and rate-limiting.
   *
   * @param params - Search parameters (keyword, status filter, pagination, etc.)
   * @returns Array of internal GfOpportunity objects
   */
  async searchGrants(params: GfSearchParams = {}): Promise<GfOpportunity[]> {
    const body = {
      keyword:      params.keyword ?? '',
      oppStatuses:  params.oppStatuses ?? 'forecasted|posted',
      rows:         params.rows ?? 25,
      sortBy:       params.sortBy ?? 'openDate|desc',
      startRecordNum: params.startRecordNum ?? 0,
      ...(params.eligibilities?.length && {
        eligibilities: params.eligibilities.join('|'),
      }),
      ...(params.fundingCategories?.length && {
        fundingCategories: params.fundingCategories.join('|'),
      }),
      ...(params.fundingInstruments?.length && {
        fundingInstruments: params.fundingInstruments.join('|'),
      }),
      ...(params.awardCeilingMin !== undefined && {
        awardCeilingMin: params.awardCeilingMin,
      }),
      ...(params.awardCeilingMax !== undefined && {
        awardCeilingMax: params.awardCeilingMax,
      }),
    };

    console.log(
      `[grants-gov] Searching opportunities — keyword="${params.keyword ?? ''}" rows=${params.rows ?? 25}`,
    );

    const raw = await this.postWithRetry<GrantsGovSearchResponse>(
      `${GRANTS_GOV_BASE_URL}/opportunities/search`,
      body,
    );

    // Normalise response shape (API returns different shapes for different result sizes)
    const hits: GrantsGovOpportunity[] =
      (raw.data?.hits as GrantsGovOpportunity[] | undefined) ??
      (raw.opportunities as GrantsGovOpportunity[] | undefined) ??
      [];

    console.log(`[grants-gov] Search returned ${hits.length} results`);

    const opportunities = hits.map(h => this.mapToInternal(h));
    return opportunities;
  }

  /**
   * Fetch full detail for a single opportunity by its Grants.gov numeric ID.
   *
   * @param oppId - Grants.gov opportunity ID
   * @returns GfOpportunity, or null if not found
   */
  async fetchOpportunity(oppId: string | number): Promise<GfOpportunity | null> {
    try {
      console.log(`[grants-gov] Fetching opportunity detail — id=${oppId}`);
      const raw = await this.getWithRetry<GrantsGovOpportunity>(
        `${GRANTS_GOV_BASE_URL}/opportunities/${oppId}`,
      );
      return this.mapToInternal(raw);
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Database Persistence
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Upsert an opportunity into the local database.
   * Uses opp_number as the unique key — updates are non-destructive
   * (preserves discovered_at on existing records).
   *
   * @param opp - GfOpportunity to persist
   * @returns Persisted GfOpportunity with database-assigned id
   */
  async persistOpportunity(opp: GfOpportunity): Promise<GfOpportunity> {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO gf_opportunities (
        id, opp_number, title, agency, agency_code, description,
        award_ceiling, award_floor, expected_awards,
        open_date, close_date, category, funding_instrument,
        eligibility, cfda_numbers, status, raw_data,
        discovered_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16, $17,
        $18, NOW()
      )
      ON CONFLICT (opp_number) DO UPDATE SET
        title              = EXCLUDED.title,
        agency             = EXCLUDED.agency,
        agency_code        = EXCLUDED.agency_code,
        description        = EXCLUDED.description,
        award_ceiling      = EXCLUDED.award_ceiling,
        award_floor        = EXCLUDED.award_floor,
        expected_awards    = EXCLUDED.expected_awards,
        open_date          = EXCLUDED.open_date,
        close_date         = EXCLUDED.close_date,
        category           = EXCLUDED.category,
        funding_instrument = EXCLUDED.funding_instrument,
        eligibility        = EXCLUDED.eligibility,
        cfda_numbers       = EXCLUDED.cfda_numbers,
        status             = EXCLUDED.status,
        raw_data           = EXCLUDED.raw_data,
        updated_at         = NOW()
      RETURNING id`,
      [
        opp.id,
        opp.oppNumber,
        opp.title,
        opp.agency,
        opp.agencyCode ?? null,
        opp.description,
        opp.awardCeiling ?? null,
        opp.awardFloor ?? null,
        opp.expectedAwards ?? null,
        opp.openDate ?? null,
        opp.closeDate ?? null,
        opp.category ?? null,
        opp.fundingInstrument ?? null,
        opp.eligibility,
        opp.cfdaNumbers,
        opp.status,
        JSON.stringify(opp.rawData),
        opp.discoveredAt,
      ],
    );
    return { ...opp, id: rows[0].id };
  }

  /**
   * List cached opportunities from the database.
   *
   * @param limit  - Max records to return (default 50)
   * @param offset - Pagination offset
   * @param status - Filter by status ('posted', 'forecasted', etc.)
   */
  async listOpportunities(
    limit = 50,
    offset = 0,
    status?: string,
  ): Promise<GfOpportunity[]> {
    let sql = `
      SELECT * FROM gf_opportunities
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }

    sql += ` ORDER BY discovered_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await this.db.query(sql, params);
    return rows.map(r => this.rowToOpportunity(r));
  }

  /**
   * Get a single opportunity from the database by internal UUID.
   */
  async getOpportunity(id: string): Promise<GfOpportunity | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM gf_opportunities WHERE id = $1',
      [id],
    );
    if (rows.length === 0) return null;
    return this.rowToOpportunity(rows[0]);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  S2S SOAP API — Application Submission
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Submit a completed application package via the Grants.gov S2S SOAP API.
   * Requires AOR credentials and optionally a client certificate.
   *
   * This is the real S2S (System-to-System) submission pathway — it sends the
   * full SF-424 XML package to Grants.gov and returns a tracking number.
   *
   * @param grantXml    - Fully formed SF-424 XML application package
   * @param credentials - AOR username/password (and optional cert path)
   * @returns Grants.gov tracking number on success
   */
  async submitApplication(
    grantXml: string,
    credentials: GrantsGovS2SCredentials,
  ): Promise<{ trackingNumber: string; submittedAt: string }> {
    const soapEnvelope = this.buildSoapEnvelope(grantXml, credentials);

    console.log('[grants-gov] Submitting S2S SOAP application package');

    const response = await this.fetchWithTimeout(GRANTS_GOV_SOAP_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction':   '"submitApplication"',
      },
      body: soapEnvelope,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `[grants-gov] S2S submission failed: ${response.status} — ${body.slice(0, 500)}`,
      );
    }

    const responseXml = await response.text();
    const trackingNumber = this.extractSoapTrackingNumber(responseXml);

    console.log(`[grants-gov] S2S submission accepted — tracking=${trackingNumber}`);
    return { trackingNumber, submittedAt: new Date().toISOString() };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Internal Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Map a raw Grants.gov API opportunity to the internal GfOpportunity type.
   */
  private mapToInternal(raw: GrantsGovOpportunity): GfOpportunity {
    return {
      id:                uuid(),
      oppNumber:         String(raw.number ?? raw.id ?? ''),
      title:             raw.title ?? 'Untitled Opportunity',
      agency:            raw.agencyName ?? raw.agencyCode ?? 'Unknown Agency',
      agencyCode:        raw.agencyCode,
      description:       raw.description ?? '',
      awardCeiling:      raw.awardCeiling ?? undefined,
      awardFloor:        raw.awardFloor ?? undefined,
      expectedAwards:    raw.expectedNumberOfAwards ?? undefined,
      openDate:          raw.openDate ?? undefined,
      closeDate:         raw.closeDate ?? undefined,
      category:          raw.fundingCategory ?? undefined,
      fundingInstrument: raw.fundingInstrument ?? undefined,
      eligibility:       raw.eligibleApplicants ?? [],
      cfdaNumbers:       raw.cfdaNumbers ?? [],
      status:            this.normaliseStatus(raw.oppStatus),
      rawData:           raw as unknown as Record<string, unknown>,
      discoveredAt:      new Date().toISOString(),
      updatedAt:         new Date().toISOString(),
    };
  }

  /**
   * Normalise Grants.gov status strings to internal enum values.
   */
  private normaliseStatus(status?: string): GfOpportunity['status'] {
    switch ((status ?? '').toLowerCase()) {
      case 'forecasted': return 'forecasted';
      case 'closed':     return 'closed';
      case 'archived':   return 'archived';
      default:           return 'posted';
    }
  }

  /**
   * Convert a database row to a GfOpportunity.
   */
  private rowToOpportunity(row: Record<string, unknown>): GfOpportunity {
    return {
      id:                row['id'] as string,
      oppNumber:         row['opp_number'] as string,
      title:             row['title'] as string,
      agency:            row['agency'] as string,
      agencyCode:        row['agency_code'] as string | undefined,
      description:       row['description'] as string,
      awardCeiling:      row['award_ceiling'] != null ? Number(row['award_ceiling']) : undefined,
      awardFloor:        row['award_floor'] != null ? Number(row['award_floor']) : undefined,
      expectedAwards:    row['expected_awards'] != null ? Number(row['expected_awards']) : undefined,
      openDate:          row['open_date'] as string | undefined,
      closeDate:         row['close_date'] as string | undefined,
      category:          row['category'] as string | undefined,
      fundingInstrument: row['funding_instrument'] as string | undefined,
      eligibility:       (row['eligibility'] as string[]) ?? [],
      cfdaNumbers:       (row['cfda_numbers'] as string[]) ?? [],
      status:            row['status'] as GfOpportunity['status'],
      rawData:           (row['raw_data'] as Record<string, unknown>) ?? {},
      discoveredAt:      (row['discovered_at'] as Date).toISOString(),
      updatedAt:         (row['updated_at'] as Date).toISOString(),
    };
  }

  /**
   * Build a minimal SOAP envelope for the Grants.gov S2S ApplyApplication operation.
   */
  private buildSoapEnvelope(grantXml: string, credentials: GrantsGovS2SCredentials): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soap:Header>
    <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <wsse:UsernameToken>
        <wsse:Username>${credentials.username}</wsse:Username>
        <wsse:Password>${credentials.password}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soap:Header>
  <soap:Body>
    <ns1:submitApplication xmlns:ns1="http://apply.grants.gov/system/ApplicantWebServices-V2.0">
      <ApplicationPackage>${Buffer.from(grantXml).toString('base64')}</ApplicationPackage>
    </ns1:submitApplication>
  </soap:Body>
</soap:Envelope>`;
  }

  /**
   * Extract the tracking number from a successful S2S SOAP response.
   */
  private extractSoapTrackingNumber(xml: string): string {
    const match = xml.match(/<GrantsGovTrackingNumber>([^<]+)<\/GrantsGovTrackingNumber>/);
    if (match?.[1]) return match[1];

    // Fallback: try generic tracking number element
    const fallback = xml.match(/<trackingNumber>([^<]+)<\/trackingNumber>/i);
    if (fallback?.[1]) return fallback[1];

    return `UNKNOWN-${Date.now()}`;
  }

  /**
   * HTTP POST with JSON body, automatic retries, and timeout.
   */
  private async postWithRetry<T>(url: string, body: unknown, retries = DEFAULT_RETRY_COUNT): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await this.fetchWithTimeout(url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body:    JSON.stringify(body),
        });

        if (res.status === 429 || res.status >= 500) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          console.warn(`[grants-gov] HTTP ${res.status} — retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
          await this.sleep(delay);
          lastErr = new Error(`HTTP ${res.status}`);
          continue;
        }

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`[grants-gov] Request failed: ${res.status} — ${text.slice(0, 300)}`);
        }

        return res.json() as Promise<T>;
      } catch (err) {
        lastErr = err;
        if (attempt < retries) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          console.warn(`[grants-gov] Request error — retrying in ${delay}ms:`, (err as Error).message);
          await this.sleep(delay);
        }
      }
    }
    throw lastErr;
  }

  /**
   * HTTP GET with automatic retries and timeout.
   */
  private async getWithRetry<T>(url: string, retries = DEFAULT_RETRY_COUNT): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await this.fetchWithTimeout(url, {
          method:  'GET',
          headers: { 'Accept': 'application/json' },
        });

        if (res.status === 404) {
          const e = new Error('Not found') as Error & { status: number };
          e.status = 404;
          throw e;
        }

        if (res.status === 429 || res.status >= 500) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          await this.sleep(delay);
          lastErr = new Error(`HTTP ${res.status}`);
          continue;
        }

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`[grants-gov] GET failed: ${res.status} — ${text.slice(0, 300)}`);
        }

        return res.json() as Promise<T>;
      } catch (err) {
        lastErr = err;
        if ((err as { status?: number }).status === 404) throw err;
        if (attempt < retries) {
          await this.sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
        }
      }
    }
    throw lastErr;
  }

  /**
   * Fetch wrapper that enforces a request timeout using AbortController.
   */
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Simple promise-based sleep */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
