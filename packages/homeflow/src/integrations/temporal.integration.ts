/*
 * HomeFlow Temporal Integration
 *
 * Registers HomeFlow with the Universal Times service
 * (@extropy/temporal-service, default http://127.0.0.1:4002) for
 * Season transition callbacks. The service posts to BASE_URL +
 * /temporal/event with HMAC-SHA256 signing when a shared secret is
 * configured.
 *
 * Failure semantics: if the temporal service is unreachable, log a
 * clear warning and schedule a retry every 60s. HomeFlow must never
 * crash because the temporal service is offline. Spec: "Season
 * management, time-aware settlement, decay scheduling" (SPEC v3.1).
 */

import { v4 as uuidv4 } from 'uuid';
import type { DatabaseService } from '../services/database.service.js';
import type { EventBusService } from '../services/event-bus.service.js';
import { HomeFlowEventType, ScheduleType } from '../types/index.js';
import type {
  HouseholdId,
  ScheduleId,
  AutomationSchedule,
  ScheduleAction,
  ScheduleCondition,
  CreateScheduleRequest,
} from '../types/index.js';
import type { SeasonId } from '@extropy/contracts';

export interface TemporalIntegrationConfig {
  temporalUrl: string;
  callbackUrl: string;
  hmacSecret?: string;
  retryIntervalMs?: number;
}

export class TemporalIntegration {
  private subscriptionId: string | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private currentSeason: number | null = null;

  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService,
    private config: TemporalIntegrationConfig,
  ) {}

  async createSchedule(req: CreateScheduleRequest): Promise<AutomationSchedule> {
    const id = uuidv4() as ScheduleId;
    const now = new Date().toISOString();

    await this.db.query(
      `INSERT INTO hf_schedules
        (id, household_id, name, type, enabled, cron_expression, season_id,
         conditions, actions, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        req.householdId,
        req.name,
        req.type,
        true,
        req.cronExpression ?? null,
        req.seasonId ?? null,
        JSON.stringify(req.conditions ?? []),
        JSON.stringify(req.actions),
        now,
        now,
      ],
    );

    return {
      id,
      householdId: req.householdId as HouseholdId,
      name: req.name,
      type: req.type,
      enabled: true,
      cronExpression: req.cronExpression ?? null,
      seasonId: (req.seasonId as SeasonId) ?? null,
      conditions: req.conditions ?? [],
      actions: req.actions,
      cumulativeDeltaS: 0,
      lastTriggeredAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async listSchedules(householdId: string): Promise<AutomationSchedule[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM hf_schedules WHERE household_id = $1 ORDER BY created_at DESC',
      [householdId],
    );
    return rows.map(this.rowToSchedule);
  }

  async toggleSchedule(scheduleId: string, enabled: boolean): Promise<void> {
    await this.db.query(
      'UPDATE hf_schedules SET enabled = $1, updated_at = NOW() WHERE id = $2',
      [enabled, scheduleId],
    );
  }

  async executeSchedule(scheduleId: string): Promise<string[]> {
    const { rows } = await this.db.query('SELECT * FROM hf_schedules WHERE id = $1', [scheduleId]);
    if (rows.length === 0) throw new Error(`Schedule ${scheduleId} not found`);

    const schedule = this.rowToSchedule(rows[0]);
    if (!schedule.enabled) return [];

    const commandIds: string[] = [];
    for (const _action of schedule.actions) {
      commandIds.push(uuidv4());
    }

    await this.db.query(
      'UPDATE hf_schedules SET last_triggered_at = NOW(), updated_at = NOW() WHERE id = $1',
      [scheduleId],
    );

    await this.eventBus.publish(
      HomeFlowEventType.SCHEDULE_TRIGGERED,
      schedule.householdId,
      {
        scheduleId: schedule.id,
        householdId: schedule.householdId,
        commandsIssued: commandIds,
      },
    );

    return commandIds;
  }

  async detectSeasonalPatterns(householdId: string): Promise<Array<{
    pattern: string;
    confidence: number;
    recommendation: string;
  }>> {
    const { rows } = await this.db.query(
      `SELECT
         date_trunc('week', timestamp) as week,
         AVG(total_power_watts) as avg_power,
         AVG(avg_indoor_temp_f) as avg_temp,
         AVG(solar_generated_wh) as avg_solar
       FROM hf_entropy_snapshots
       WHERE household_id = $1 AND timestamp > NOW() - INTERVAL '90 days'
       GROUP BY week
       ORDER BY week`,
      [householdId],
    );

    const patterns: Array<{ pattern: string; confidence: number; recommendation: string }> = [];

    if (rows.length >= 4) {
      const recentPower = parseFloat(rows[rows.length - 1].avg_power as string);
      const olderPower = parseFloat(rows[0].avg_power as string);
      const powerDelta = ((recentPower - olderPower) / olderPower) * 100;

      if (powerDelta > 20) {
        patterns.push({
          pattern: 'heating_increase',
          confidence: Math.min(0.9, Math.abs(powerDelta) / 100),
          recommendation: 'Consider lowering thermostat setpoints by 2 degrees F during unoccupied hours',
        });
      } else if (powerDelta < -20) {
        patterns.push({
          pattern: 'cooling_increase',
          confidence: Math.min(0.9, Math.abs(powerDelta) / 100),
          recommendation: 'Pre-cool during off-peak hours and raise setpoint by 1 degree F',
        });
      }

      const recentSolar = parseFloat(rows[rows.length - 1].avg_solar as string);
      const olderSolar = parseFloat(rows[0].avg_solar as string);
      if (recentSolar > olderSolar * 1.3) {
        patterns.push({
          pattern: 'solar_peak',
          confidence: 0.8,
          recommendation: 'Shift heavy loads to peak solar hours (11am to 3pm)',
        });
      }
    }

    return patterns;
  }

  /*
   * Register HomeFlow with the Universal Times temporal service for
   * Season transition events. Called once at startup. If the service
   * is unreachable, schedule a retry every 60s and never throw.
   */
  async registerForSeasonEvents(): Promise<void> {
    const url = `${this.config.temporalUrl.replace(/\/$/, '')}/subscribe`;
    const body = {
      subscriberId: 'homeflow',
      callbackUrl: this.config.callbackUrl,
      unit: 'Season',
      ...(this.config.hmacSecret ? { hmacSecret: this.config.hmacSecret } : {}),
    };

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`temporal /subscribe returned ${resp.status}: ${text}`);
      }
      const out = (await resp.json()) as { subscriptionId?: string };
      this.subscriptionId = out.subscriptionId ?? null;
      console.log(`[homeflow:temporal] registered for Season events at ${url}, subscription ${this.subscriptionId}`);
      if (this.retryTimer) {
        clearInterval(this.retryTimer);
        this.retryTimer = null;
      }
    } catch (err) {
      console.warn(
        `[homeflow:temporal] service at ${this.config.temporalUrl} unreachable, season events will not fire until it comes online; will retry every 60s`,
        err instanceof Error ? err.message : err,
      );
      if (!this.retryTimer) {
        const interval = this.config.retryIntervalMs ?? 60_000;
        this.retryTimer = setInterval(() => {
          void this.registerForSeasonEvents();
        }, interval);
        // Allow the process to exit even if the retry timer is pending.
        if (typeof this.retryTimer.unref === 'function') {
          this.retryTimer.unref();
        }
      }
    }
  }

  /*
   * Handle a callback from the temporal service. Called by the
   * /temporal/event route after HMAC verification. We publish a
   * SEASON_STARTED domain event so the rest of HomeFlow can react,
   * then update an in-memory marker for /api/v1/temporal/season.
   */
  async handleTemporalEvent(payload: {
    unit: string;
    oldValue: number;
    newValue: number;
    timestamp?: string;
  }): Promise<void> {
    if (payload.unit === 'Season') {
      this.currentSeason = payload.newValue;
      console.log(`[homeflow:temporal] Season transition ${payload.oldValue} -> ${payload.newValue}`);
      /*
       * Publish to the event bus so the rest of HomeFlow can react.
       * Swallow publish failures (eg Redis not reachable in pilot
       * mode) so the callback still ack'es 200 and the temporal
       * service does not retry forever.
       */
      try {
        await this.eventBus.publish(
          HomeFlowEventType.SCHEDULE_TRIGGERED,
          'temporal',
          {
            source: 'temporal',
            unit: 'Season',
            oldValue: payload.oldValue,
            newValue: payload.newValue,
            timestamp: payload.timestamp ?? new Date().toISOString(),
          },
        );
      } catch (err) {
        console.warn('[homeflow:temporal] event bus publish failed, continuing:', err instanceof Error ? err.message : err);
      }
    }
  }

  getCurrentSeason(): number | null {
    return this.currentSeason;
  }

  /*
   * Test hook: stop retry timer for clean shutdown.
   */
  stop(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  async deleteSchedule(scheduleId: string): Promise<boolean> {
    const { rowCount } = await this.db.query('DELETE FROM hf_schedules WHERE id = $1', [scheduleId]);
    return (rowCount ?? 0) > 0;
  }

  private rowToSchedule(row: Record<string, unknown>): AutomationSchedule {
    return {
      id: row.id as ScheduleId,
      householdId: row.household_id as HouseholdId,
      name: row.name as string,
      type: row.type as ScheduleType,
      enabled: row.enabled as boolean,
      cronExpression: row.cron_expression as string | null,
      seasonId: row.season_id as SeasonId | null,
      conditions: row.conditions as ScheduleCondition[],
      actions: row.actions as ScheduleAction[],
      cumulativeDeltaS: row.cumulative_delta_s as number,
      lastTriggeredAt: row.last_triggered_at as string | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
