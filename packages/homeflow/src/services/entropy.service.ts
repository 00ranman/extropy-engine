/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Entropy Measurement Service
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Measures thermodynamic entropy reduction from home automation actions:
 *    - Energy savings → ΔS = ΔQ/T (J/K)
 *    - Temperature optimization (reduced deviation from setpoint)
 *    - Resource efficiency (water, solar utilization)
 *
 *  Emits EntropyMeasurement events to Loop Ledger when ΔS > 0.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuidv4 } from 'uuid';
import type { DatabaseService } from './database.service.js';
import type { EventBusService } from './event-bus.service.js';
import type {
  HomeEntropySnapshot,
  HomeEntropyReduction,
  HouseholdId,
  DeviceId,
} from '../types/index.js';
import { HomeFlowEventType } from '../types/index.js';
import { EntropyDomain, EventType } from '@extropy/contracts';
import type { LoopId, MeasurementId, EntropyMeasurement } from '@extropy/contracts';

/**
 * Physical constants for entropy calculation.
 *
 * The core conversion: kWh → Joules, then ΔS = ΔQ / T
 * where T is the average absolute temperature in Kelvin.
 *
 * 1 kWh = 3,600,000 J
 * T_indoor ≈ 295K (72°F)
 */
const JOULES_PER_WH = 3600;
const FAHRENHEIT_TO_KELVIN = (f: number) => (f - 32) * 5 / 9 + 273.15;

export class EntropyService {
  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService,
    private config: {
      epistemologyUrl: string;
      loopLedgerUrl: string;
    },
  ) {}

  /**
   * Take an entropy snapshot of the current household state.
   * Reads all device states and computes aggregate entropy.
   */
  async takeSnapshot(householdId: string): Promise<HomeEntropySnapshot> {
    const now = new Date().toISOString();

    // Aggregate device readings
    const { rows: devices } = await this.db.query(
      `SELECT type, state FROM hf_devices WHERE household_id = $1 AND status = 'online'`,
      [householdId],
    );

    let totalPowerWatts = 0;
    let tempSum = 0;
    let tempCount = 0;
    let humiditySum = 0;
    let humidityCount = 0;
    let solarGeneratedWh = 0;

    for (const d of devices) {
      const state = d.state as Record<string, unknown>;
      if (typeof state.powerWatts === 'number') totalPowerWatts += state.powerWatts;
      if (typeof state.temperatureF === 'number') { tempSum += state.temperatureF; tempCount++; }
      if (typeof state.humidityPct === 'number') { humiditySum += state.humidityPct; humidityCount++; }
      if (typeof state.energyGeneratedWh === 'number') solarGeneratedWh += state.energyGeneratedWh;
    }

    const avgIndoorTempF = tempCount > 0 ? tempSum / tempCount : 72;
    const avgHumidityPct = humidityCount > 0 ? humiditySum / humidityCount : 45;

    // Zone occupancy
    const { rows: zones } = await this.db.query(
      `SELECT is_occupied FROM hf_zones WHERE household_id = $1`,
      [householdId],
    );
    const occupiedZones = zones.filter(z => z.is_occupied).length;
    const totalZones = zones.length;

    // Compute energy consumed since last snapshot (in Wh) — use 15-min interval assumption
    const energyConsumedWh = totalPowerWatts * 0.25; // 15 minutes = 0.25 hours

    // Entropy calculation:
    // S = Q / T where Q = energy in Joules, T in Kelvin
    const T_kelvin = FAHRENHEIT_TO_KELVIN(avgIndoorTempF);
    const Q_joules = energyConsumedWh * JOULES_PER_WH;
    const entropyJoulePerKelvin = T_kelvin > 0 ? Q_joules / T_kelvin : 0;

    const snapshot: HomeEntropySnapshot = {
      householdId: householdId as HouseholdId,
      timestamp: now,
      totalPowerWatts,
      energyConsumedWh,
      avgIndoorTempF,
      outdoorTempF: null, // Would come from weather API
      avgHumidityPct,
      solarGeneratedWh,
      occupiedZones,
      totalZones,
      entropyJoulePerKelvin,
    };

    // Persist
    await this.db.query(
      `INSERT INTO hf_entropy_snapshots
        (household_id, timestamp, total_power_watts, energy_consumed_wh,
         avg_indoor_temp_f, outdoor_temp_f, avg_humidity_pct, solar_generated_wh,
         occupied_zones, total_zones, entropy_joule_per_kelvin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        householdId, now, totalPowerWatts, energyConsumedWh,
        avgIndoorTempF, null, avgHumidityPct, solarGeneratedWh,
        occupiedZones, totalZones, entropyJoulePerKelvin,
      ],
    );

    await this.eventBus.publish(
      HomeFlowEventType.ENTROPY_SNAPSHOT,
      householdId,
      { snapshot },
    );

    return snapshot;
  }

  /**
   * Measure entropy reduction between two snapshots.
   * If ΔS > 0, emit to Loop Ledger and auto-generate a claim.
   */
  async measureReduction(
    householdId: string,
    causalCommandIds: string[] = [],
  ): Promise<HomeEntropyReduction | null> {
    // Get latest two snapshots
    const { rows } = await this.db.query(
      `SELECT * FROM hf_entropy_snapshots
       WHERE household_id = $1
       ORDER BY timestamp DESC LIMIT 2`,
      [householdId],
    );

    if (rows.length < 2) {
      console.log('[homeflow:entropy] Not enough snapshots for reduction measurement');
      return null;
    }

    const afterRow = rows[0];
    const beforeRow = rows[1];

    const before = this.rowToSnapshot(beforeRow, householdId);
    const after = this.rowToSnapshot(afterRow, householdId);

    // ΔS = S_before - S_after (positive means entropy was reduced)
    const rawDeltaS = before.entropyJoulePerKelvin - after.entropyJoulePerKelvin;

    // Breakdown
    const T_before = FAHRENHEIT_TO_KELVIN(before.avgIndoorTempF);
    const T_after = FAHRENHEIT_TO_KELVIN(after.avgIndoorTempF);

    const energySavingsJK = T_after > 0
      ? ((before.energyConsumedWh - after.energyConsumedWh) * JOULES_PER_WH) / T_after
      : 0;

    // Temperature optimization: entropy reduction from moving closer to setpoint
    // Measure as the reduction in temperature variance
    const tempOptJK = Math.max(0, Math.abs(before.avgIndoorTempF - 72) - Math.abs(after.avgIndoorTempF - 72)) * 10;

    // Resource efficiency: solar utilization improvement
    const resourceEffJK = T_after > 0
      ? ((after.solarGeneratedWh - before.solarGeneratedWh) * JOULES_PER_WH) / T_after
      : 0;

    const deltaS = Math.max(0, energySavingsJK + tempOptJK + resourceEffJK);

    if (deltaS <= 0) {
      console.log('[homeflow:entropy] No entropy reduction detected (ΔS ≤ 0)');
      return null;
    }

    // Compute confidence from sensor coverage
    const { rows: deviceCount } = await this.db.query(
      `SELECT COUNT(*) as cnt FROM hf_devices WHERE household_id = $1 AND status = 'online'`,
      [householdId],
    );
    const sensorCoverage = Math.min(1, parseInt(deviceCount[0].cnt) / 5); // 5+ sensors = full confidence
    const confidence = 0.5 + 0.5 * sensorCoverage;

    const reductionId = uuidv4();
    const reduction: HomeEntropyReduction = {
      householdId: householdId as HouseholdId,
      before,
      after,
      deltaS,
      breakdown: {
        energySavingsJK: Math.max(0, energySavingsJK),
        temperatureOptimizationJK: Math.max(0, tempOptJK),
        resourceEfficiencyJK: Math.max(0, resourceEffJK),
      },
      causalCommandIds,
      confidence,
      measuredAt: new Date().toISOString(),
    };

    // Persist
    await this.db.query(
      `INSERT INTO hf_entropy_reductions
        (id, household_id, before_snapshot_id, after_snapshot_id, delta_s,
         breakdown, causal_command_ids, confidence, measured_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        reductionId, householdId, beforeRow.id, afterRow.id,
        deltaS, JSON.stringify(reduction.breakdown),
        causalCommandIds, confidence, reduction.measuredAt,
      ],
    );

    // Emit entropy reduction event
    await this.eventBus.publish(
      HomeFlowEventType.ENTROPY_REDUCTION,
      householdId,
      { reduction, loopId: null },
    );

    // Emit measurement to Loop Ledger via shared event bus
    const measurementId = uuidv4() as MeasurementId;
    const measurement: EntropyMeasurement = {
      id: measurementId,
      loopId: '' as LoopId, // Will be assigned by Loop Ledger
      domain: EntropyDomain.THERMODYNAMIC,
      value: deltaS,
      uncertainty: 1 - confidence,
      source: {
        type: 'sensor',
        identifier: `homeflow:${householdId}`,
        calibrationHash: undefined,
      },
      timestamp: reduction.measuredAt,
      rawPayload: {
        householdId,
        breakdown: reduction.breakdown,
        before: { energy: before.energyConsumedWh, temp: before.avgIndoorTempF },
        after: { energy: after.energyConsumedWh, temp: after.avgIndoorTempF },
      },
    };

    await this.eventBus.publishRaw(
      EventType.LOOP_MEASUREMENT_RECORDED,
      householdId,
      { measurement, phase: 'after', source: 'homeflow' },
    );

    console.log(`[homeflow:entropy] Measured ΔS = ${deltaS.toFixed(4)} J/K for household ${householdId}`);

    return reduction;
  }

  /**
   * Get entropy history for a household.
   */
  async getReductionHistory(householdId: string, limit = 50): Promise<HomeEntropyReduction[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM hf_entropy_reductions WHERE household_id = $1 ORDER BY measured_at DESC LIMIT $2`,
      [householdId, limit],
    );
    return rows.map(r => ({
      householdId: r.household_id as HouseholdId,
      before: {} as HomeEntropySnapshot, // Simplified — would join snapshots
      after: {} as HomeEntropySnapshot,
      deltaS: r.delta_s,
      breakdown: r.breakdown,
      causalCommandIds: r.causal_command_ids,
      confidence: r.confidence,
      measuredAt: r.measured_at,
    }));
  }

  /**
   * Get cumulative ΔS for a household (total entropy reduced).
   */
  async getCumulativeDeltaS(householdId: string): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT COALESCE(SUM(delta_s), 0) as total FROM hf_entropy_reductions WHERE household_id = $1`,
      [householdId],
    );
    return parseFloat(rows[0].total);
  }

  private rowToSnapshot(row: Record<string, unknown>, householdId: string): HomeEntropySnapshot {
    return {
      householdId: householdId as HouseholdId,
      timestamp: row.timestamp as string,
      totalPowerWatts: row.total_power_watts as number,
      energyConsumedWh: row.energy_consumed_wh as number,
      avgIndoorTempF: row.avg_indoor_temp_f as number ?? 72,
      outdoorTempF: row.outdoor_temp_f as number | null,
      avgHumidityPct: row.avg_humidity_pct as number ?? 45,
      solarGeneratedWh: row.solar_generated_wh as number,
      occupiedZones: row.occupied_zones as number,
      totalZones: row.total_zones as number,
      entropyJoulePerKelvin: row.entropy_joule_per_kelvin as number,
    };
  }
}
