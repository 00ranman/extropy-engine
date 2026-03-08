/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Ecosystem Interoperability Service
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  This is the CRITICAL interoperability layer that enables HomeFlow to
 *  work with ALL existing AND future ecosystem apps.
 *
 *  Design:
 *    1. Plugin/Adapter pattern for cross-app integration
 *    2. Standardized /events webhook endpoint
 *    3. Cross-domain entropy aggregation
 *    4. Auto-discovery via interop manifest
 *    5. Typed event exchange with any service
 *
 *  Supported integrations (current + future):
 *    - AcademicXP, LevelUp Academy, News Buddy, Language Learning
 *    - AI Family Task Planner, Global Civilization Simulator
 *    - Any future app that publishes to EventPayloadMap
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuidv4 } from 'uuid';
import type { DatabaseService } from '../services/database.service.js';
import type { EventBusService } from '../services/event-bus.service.js';
import type { EntropyService } from '../services/entropy.service.js';
import { HomeFlowEventType } from '../types/index.js';
import type { HouseholdId, IncomingWebhookEvent } from '../types/index.js';
import { EventType, EntropyDomain } from '@extropy/contracts';
import type { DomainEvent, LoopId } from '@extropy/contracts';

// ─────────────────────────────────────────────────────────────────────────────
//  Plugin/Adapter Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every ecosystem app that wants to integrate with HomeFlow implements this.
 * This is the adapter pattern — HomeFlow doesn't need to know app internals.
 */
export interface EcosystemAppAdapter {
  /** Unique identifier for the app */
  appId: string;
  /** Human-readable name */
  appName: string;
  /** Which entropy domains this app produces data in */
  entropyDomains: EntropyDomain[];
  /** Which event types this app publishes */
  publishedEvents: string[];
  /** Which event types this app subscribes to */
  subscribedEvents: string[];

  /**
   * Called when HomeFlow receives an event from this app.
   * Returns optional cross-domain entropy data.
   */
  handleEvent(event: DomainEvent): Promise<CrossDomainEntropyData | null>;

  /**
   * Called to validate an entropy claim from this app.
   * HomeFlow can cross-validate using its sensor data.
   */
  validateCrossDomainClaim?(
    claimDomain: EntropyDomain,
    deltaS: number,
    metadata: Record<string, unknown>,
  ): Promise<{ valid: boolean; confidence: number; justification: string }>;
}

export interface CrossDomainEntropyData {
  sourceApp: string;
  sourceDomain: EntropyDomain;
  sourceDeltaS: number;
  timestamp: string;
  metadata: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Built-in Adapters for Known Ecosystem Apps
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generic adapter for any app that follows Extropy Engine event conventions.
 * This is the fallback for apps we don't have a specific adapter for.
 */
class GenericAppAdapter implements EcosystemAppAdapter {
  constructor(
    public appId: string,
    public appName: string,
    public entropyDomains: EntropyDomain[],
    public publishedEvents: string[],
    public subscribedEvents: string[],
  ) {}

  async handleEvent(event: DomainEvent): Promise<CrossDomainEntropyData | null> {
    const payload = event.payload as Record<string, unknown>;
    if (typeof payload.deltaS === 'number' && payload.deltaS > 0) {
      return {
        sourceApp: this.appId,
        sourceDomain: (payload.domain as EntropyDomain) ?? this.entropyDomains[0] ?? EntropyDomain.INFORMATIONAL,
        sourceDeltaS: payload.deltaS as number,
        timestamp: event.timestamp,
        metadata: payload,
      };
    }
    return null;
  }
}

/** AcademicXP adapter — learning gains translate to cognitive entropy reduction */
class AcademicXPAdapter extends GenericAppAdapter {
  constructor() {
    super(
      'academic-xp',
      'AcademicXP',
      [EntropyDomain.COGNITIVE, EntropyDomain.INFORMATIONAL],
      ['academicxp.study.completed', 'academicxp.exam.passed', 'academicxp.research.published'],
      [HomeFlowEventType.ENTROPY_REDUCTION, HomeFlowEventType.CROSS_DOMAIN_AGGREGATE],
    );
  }

  async validateCrossDomainClaim(
    claimDomain: EntropyDomain,
    deltaS: number,
    metadata: Record<string, unknown>,
  ): Promise<{ valid: boolean; confidence: number; justification: string }> {
    // AcademicXP claims in cognitive domain — HomeFlow can't directly validate
    // but can confirm the claim was made by a household member
    return {
      valid: true,
      confidence: 0.5,
      justification: 'Cross-domain claim accepted at base confidence — HomeFlow cannot directly validate cognitive entropy',
    };
  }
}

/** Family Task Planner adapter — household task completion reduces social entropy */
class FamilyTaskPlannerAdapter extends GenericAppAdapter {
  constructor() {
    super(
      'family-task-planner',
      'AI Family Task Planner',
      [EntropyDomain.SOCIAL, EntropyDomain.ECONOMIC],
      ['family.task.completed', 'family.chore.verified', 'family.budget.optimized'],
      [HomeFlowEventType.ENTROPY_REDUCTION, HomeFlowEventType.SCHEDULE_TRIGGERED],
    );
  }

  async handleEvent(event: DomainEvent): Promise<CrossDomainEntropyData | null> {
    const payload = event.payload as Record<string, unknown>;
    // Family tasks that overlap with home automation (e.g., "turn off lights when leaving")
    if ((event.type as string) === 'family.chore.verified' && typeof payload.deltaS === 'number') {
      return {
        sourceApp: this.appId,
        sourceDomain: EntropyDomain.SOCIAL,
        sourceDeltaS: payload.deltaS as number,
        timestamp: event.timestamp,
        metadata: payload,
      };
    }
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Interop Service
// ─────────────────────────────────────────────────────────────────────────────

export class InteropService {
  private adapters: Map<string, EcosystemAppAdapter> = new Map();

  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService,
    private entropyService: EntropyService,
  ) {
    // Register built-in adapters
    this.registerAdapter(new AcademicXPAdapter());
    this.registerAdapter(new FamilyTaskPlannerAdapter());
    this.registerAdapter(new GenericAppAdapter(
      'levelup-academy', 'LevelUp Academy',
      [EntropyDomain.COGNITIVE],
      ['levelup.lesson.completed', 'levelup.skill.mastered'],
      [HomeFlowEventType.ENTROPY_REDUCTION],
    ));
    this.registerAdapter(new GenericAppAdapter(
      'news-buddy', 'News Buddy',
      [EntropyDomain.INFORMATIONAL],
      ['newsbuddy.article.verified', 'newsbuddy.source.rated'],
      [HomeFlowEventType.ENTROPY_REDUCTION],
    ));
    this.registerAdapter(new GenericAppAdapter(
      'language-learning', 'Language Learning',
      [EntropyDomain.COGNITIVE],
      ['language.lesson.completed', 'language.fluency.assessed'],
      [HomeFlowEventType.ENTROPY_REDUCTION],
    ));
    this.registerAdapter(new GenericAppAdapter(
      'global-civ-sim', 'Global Civilization Simulator',
      [EntropyDomain.GOVERNANCE, EntropyDomain.SOCIAL],
      ['civsim.policy.simulated', 'civsim.outcome.measured'],
      [HomeFlowEventType.ENTROPY_REDUCTION],
    ));
  }

  /**
   * Register a new ecosystem app adapter.
   * This is how future apps plug into HomeFlow.
   */
  registerAdapter(adapter: EcosystemAppAdapter): void {
    this.adapters.set(adapter.appId, adapter);
    console.log(`[homeflow:interop] Registered adapter: ${adapter.appName} (${adapter.appId})`);
  }

  /**
   * Get a registered adapter.
   */
  getAdapter(appId: string): EcosystemAppAdapter | undefined {
    return this.adapters.get(appId);
  }

  /**
   * List all registered adapters.
   */
  listAdapters(): EcosystemAppAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Handle an incoming webhook event from any ecosystem app.
   * This is the standardized /events endpoint handler.
   */
  async handleIncomingEvent(event: IncomingWebhookEvent): Promise<{
    processed: boolean;
    crossDomainData?: CrossDomainEntropyData;
    aggregation?: { compositeDeltaS: number; compositeXP: number };
  }> {
    const sourceApp = event.source;
    const adapter = this.adapters.get(sourceApp);

    if (!adapter) {
      // No specific adapter — use generic processing
      console.log(`[homeflow:interop] No adapter for ${sourceApp}, using generic processing`);
    }

    // Convert to DomainEvent
    const domainEvent: DomainEvent = {
      eventId: event.eventId,
      type: event.type as any,
      payload: event.payload,
      source: event.source as any,
      correlationId: event.correlationId as any,
      timestamp: event.timestamp,
      version: event.version,
    };

    // Route to adapter
    let crossDomainData: CrossDomainEntropyData | null = null;
    if (adapter) {
      crossDomainData = await adapter.handleEvent(domainEvent);
    }

    // If cross-domain entropy data was extracted, aggregate with HomeFlow data
    if (crossDomainData) {
      const aggregation = await this.aggregateCrossDomainEntropy(crossDomainData);
      return { processed: true, crossDomainData, aggregation };
    }

    return { processed: true };
  }

  /**
   * Aggregate cross-domain entropy with HomeFlow data.
   *
   * Composite household XP = HomeFlow ΔS + weighted sum of other domain ΔS values.
   * Cross-domain weight = 0.3 (to prevent gaming via domain-hopping).
   */
  async aggregateCrossDomainEntropy(
    externalData: CrossDomainEntropyData,
  ): Promise<{ compositeDeltaS: number; compositeXP: number }> {
    const CROSS_DOMAIN_WEIGHT = 0.3;

    // Get HomeFlow's latest ΔS for the household (if available)
    // This requires knowing which household the external data relates to
    const householdId = (externalData.metadata.householdId as string) ?? 'unknown';
    let homeflowDeltaS = 0;

    if (householdId !== 'unknown') {
      homeflowDeltaS = await this.entropyService.getCumulativeDeltaS(householdId);
    }

    const compositeDeltaS = homeflowDeltaS + externalData.sourceDeltaS * CROSS_DOMAIN_WEIGHT;
    const compositeXP = compositeDeltaS * 10; // Simplified XP calculation

    // Record aggregation
    if (householdId !== 'unknown') {
      await this.db.query(
        `INSERT INTO hf_cross_domain_aggregations
          (id, household_id, source_app, source_domain, source_delta_s,
           homeflow_delta_s, composite_delta_s, composite_xp, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [
          uuidv4(), householdId, externalData.sourceApp,
          externalData.sourceDomain, externalData.sourceDeltaS,
          homeflowDeltaS, compositeDeltaS, compositeXP,
        ],
      );

      await this.eventBus.publish(
        HomeFlowEventType.CROSS_DOMAIN_AGGREGATE,
        householdId,
        {
          householdId: householdId as HouseholdId,
          sourceApp: externalData.sourceApp,
          sourceDomain: externalData.sourceDomain,
          sourceDeltaS: externalData.sourceDeltaS,
          homeflowDeltaS,
          compositeDeltaS,
          compositeXP,
        },
      );
    }

    return { compositeDeltaS, compositeXP };
  }

  /**
   * Get cross-domain aggregation history.
   */
  async getAggregationHistory(householdId: string, limit = 50) {
    const { rows } = await this.db.query(
      `SELECT * FROM hf_cross_domain_aggregations WHERE household_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [householdId, limit],
    );
    return rows;
  }

  /**
   * Generate the interop manifest for auto-discovery.
   */
  getInteropManifest(): InteropManifest {
    return {
      appId: 'homeflow',
      appName: 'HomeFlow',
      version: '1.0.0',
      description: 'IoT-integrated smart home/building management with thermodynamic entropy reduction measurement',
      port: 4015,
      healthEndpoint: '/health',
      eventsEndpoint: '/events',
      apiBase: '/api/v1',
      entropyDomains: [EntropyDomain.THERMODYNAMIC, EntropyDomain.ECONOMIC],
      capabilities: [
        'device_management',
        'entropy_measurement',
        'claim_generation',
        'task_validation',
        'cross_domain_aggregation',
        'household_dfao',
        'energy_credits',
        'efficiency_credentials',
        'seasonal_patterns',
        'automation_schedules',
      ],
      publishedEvents: Object.values(HomeFlowEventType),
      subscribedEvents: [
        // Core events HomeFlow listens to
        EventType.CLAIM_EVALUATED,
        EventType.CLAIM_SUBMITTED,
        EventType.TASK_ASSIGNED,
        EventType.TASK_COMPLETED,
        EventType.LOOP_CLOSED,
        EventType.LOOP_FAILED,
        EventType.LOOP_SETTLED,
        EventType.XP_MINTED_PROVISIONAL,
        EventType.XP_CONFIRMED,
        EventType.REPUTATION_ACCRUED,
        EventType.SEASON_STARTED,
        EventType.SEASON_ENDED,
        EventType.TOKEN_MINTED,
        EventType.CREDENTIAL_ISSUED,
        EventType.DFAO_CREATED,
        EventType.VERTEX_CREATED,
      ],
      apiEndpoints: [
        { method: 'GET',    path: '/health',                    description: 'Service health check' },
        { method: 'POST',   path: '/events',                    description: 'Webhook endpoint for incoming events' },
        { method: 'POST',   path: '/api/v1/households',         description: 'Create a household' },
        { method: 'GET',    path: '/api/v1/households/:id',     description: 'Get household details' },
        { method: 'POST',   path: '/api/v1/zones',              description: 'Create a zone' },
        { method: 'GET',    path: '/api/v1/zones/:id',          description: 'Get zone details' },
        { method: 'POST',   path: '/api/v1/devices',            description: 'Register a device' },
        { method: 'GET',    path: '/api/v1/devices/:id',        description: 'Get device details' },
        { method: 'PATCH',  path: '/api/v1/devices/:id',        description: 'Update device' },
        { method: 'DELETE', path: '/api/v1/devices/:id',        description: 'Delete device' },
        { method: 'POST',   path: '/api/v1/devices/:id/commands', description: 'Issue command to device' },
        { method: 'GET',    path: '/api/v1/devices/:id/commands', description: 'Get command history' },
        { method: 'POST',   path: '/api/v1/entropy/snapshot',   description: 'Take entropy snapshot' },
        { method: 'POST',   path: '/api/v1/entropy/measure',    description: 'Measure entropy reduction' },
        { method: 'GET',    path: '/api/v1/entropy/:householdId/history', description: 'Get entropy history' },
        { method: 'GET',    path: '/api/v1/claims/:householdId', description: 'Get claims history' },
        { method: 'POST',   path: '/api/v1/schedules',          description: 'Create automation schedule' },
        { method: 'GET',    path: '/api/v1/schedules/:householdId', description: 'List schedules' },
        { method: 'POST',   path: '/api/v1/governance/dfao',    description: 'Create household DFAO' },
        { method: 'GET',    path: '/api/v1/tokens/:householdId', description: 'Get token balances' },
        { method: 'GET',    path: '/api/v1/credentials/:householdId', description: 'Get credentials' },
        { method: 'GET',    path: '/api/v1/interop/manifest',   description: 'Get interop manifest' },
        { method: 'GET',    path: '/api/v1/interop/adapters',   description: 'List registered adapters' },
        { method: 'POST',   path: '/api/v1/interop/adapters',   description: 'Register new adapter' },
      ],
      crossDomainAggregation: {
        supported: true,
        weight: 0.3,
        description: 'HomeFlow energy savings + other domain ΔS = composite household XP',
      },
      registeredAdapters: this.listAdapters().map(a => ({
        appId: a.appId,
        appName: a.appName,
        entropyDomains: a.entropyDomains,
      })),
    };
  }
}

// ── Manifest Type ────────────────────────────────────────────────────────────

export interface InteropManifest {
  appId: string;
  appName: string;
  version: string;
  description: string;
  port: number;
  healthEndpoint: string;
  eventsEndpoint: string;
  apiBase: string;
  entropyDomains: EntropyDomain[];
  capabilities: string[];
  publishedEvents: string[];
  subscribedEvents: string[];
  apiEndpoints: Array<{ method: string; path: string; description: string }>;
  crossDomainAggregation: {
    supported: boolean;
    weight: number;
    description: string;
  };
  registeredAdapters: Array<{
    appId: string;
    appName: string;
    entropyDomains: EntropyDomain[];
  }>;
}
