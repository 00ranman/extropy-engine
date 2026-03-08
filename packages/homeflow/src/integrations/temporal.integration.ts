/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Temporal Integration
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Integrates with the Temporal service for:
 *    - Seasonal patterns (heating/cooling seasons, baseline shifts)
 *    - Time-based automation schedules
 *    - Loop timeout management
 *    - Seasonal XP multipliers
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuidv4 } from 'uuid';
import type { DatabaseService } from '../services/database.service.js';
import type { EventBusService } from '../services/event-bus.service.js';
import { HomeFlowEventType, ScheduleType } from '../types/index.js';
import type { HouseholdId, ScheduleId, AutomationSchedule, ScheduleAction, ScheduleCondition, CreateScheduleRequest } from '../types/index.js';
import type { SeasonId } from '@extropy/contracts';

export class TemporalIntegration {
  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService,
    private config: {
      temporalUrl: string;
    },
  ) {}

  /**
   * Create an automation schedule.
   */
  async createSchedule(req: CreateScheduleRequest): Promise<AutomationSchedule> {
    const id = uuidv4() as ScheduleId;
    const now = new Date().toISOString();

    await this.db.query(
      `INSERT INTO hf_schedules
        (id, household_id, name, type, enabled, cron_expression, season_id,
         conditions, actions, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id, req.householdId, req.name, req.type, true,
        req.cronExpression ?? null, req.seasonId ?? null,
        JSON.stringify(req.conditions ?? []), JSON.stringify(req.actions),
        now, now,
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

  /**
   * Get schedules for a household.
   */
  async listSchedules(householdId: string): Promise<AutomationSchedule[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM hf_schedules WHERE household_id = $1 ORDER BY created_at DESC',
      [householdId],
    );
    return rows.map(this.rowToSchedule);
  }

  /**
   * Enable/disable a schedule.
   */
  async toggleSchedule(scheduleId: string, enabled: boolean): Promise<void> {
    await this.db.query(
      'UPDATE hf_schedules SET enabled = $1, updated_at = NOW() WHERE id = $2',
      [enabled, scheduleId],
    );
  }

  /**
   * Execute a schedule's actions (called by cron or event trigger).
   */
  async executeSchedule(scheduleId: string): Promise<string[]> {
    const { rows } = await this.db.query('SELECT * FROM hf_schedules WHERE id = $1', [scheduleId]);
    if (rows.length === 0) throw new Error(`Schedule ${scheduleId} not found`);

    const schedule = this.rowToSchedule(rows[0]);
    if (!schedule.enabled) return [];

    // Execute each action (command issuance handled by caller)
    const commandIds: string[] = [];
    for (const action of schedule.actions) {
      commandIds.push(uuidv4()); // Placeholder — actual command execution via device service
    }

    // Update last triggered
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

  /**
   * Detect seasonal patterns from entropy history.
   */
  async detectSeasonalPatterns(householdId: string): Promise<Array<{
    pattern: string;
    confidence: number;
    recommendation: string;
  }>> {
    // Analyze last 90 days of snapshots for patterns
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
      const recentPower = parseFloat(rows[rows.length - 1].avg_power);
      const olderPower = parseFloat(rows[0].avg_power);
      const powerDelta = ((recentPower - olderPower) / olderPower) * 100;

      if (powerDelta > 20) {
        patterns.push({
          pattern: 'heating_increase',
          confidence: Math.min(0.9, Math.abs(powerDelta) / 100),
          recommendation: 'Consider lowering thermostat setpoints by 2°F during unoccupied hours',
        });
      } else if (powerDelta < -20) {
        patterns.push({
          pattern: 'cooling_increase',
          confidence: Math.min(0.9, Math.abs(powerDelta) / 100),
          recommendation: 'Pre-cool during off-peak hours and raise setpoint by 1°F',
        });
      }

      // Solar pattern
      const recentSolar = parseFloat(rows[rows.length - 1].avg_solar);
      const olderSolar = parseFloat(rows[0].avg_solar);
      if (recentSolar > olderSolar * 1.3) {
        patterns.push({
          pattern: 'solar_peak',
          confidence: 0.8,
          recommendation: 'Shift heavy loads to peak solar hours (11am-3pm)',
        });
      }
    }

    return patterns;
  }

  /**
   * Register with the Temporal service for season change notifications.
   */
  async registerForSeasonEvents(): Promise<void> {
    try {
      await fetch(`${this.config.temporalUrl}/subscribers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: 'homeflow',
          events: ['temporal.season.started', 'temporal.season.ended', 'temporal.reputation.decay_tick'],
          callbackUrl: 'http://homeflow:4015/events',
        }),
      });
      console.log('[homeflow:temporal] Registered for season events');
    } catch (err) {
      console.warn('[homeflow:temporal] Failed to register for season events:', err);
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
