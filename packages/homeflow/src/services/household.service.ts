/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Household & Zone Service
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Manages households, zones, and household-level operations.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuidv4 } from 'uuid';
import type { DatabaseService } from './database.service.js';
import type { EventBusService } from './event-bus.service.js';
import type {
  Household,
  HouseholdId,
  Zone,
  ZoneId,
  CreateHouseholdRequest,
  CreateZoneRequest,
} from '../types/index.js';
import type { ValidatorId, DFAOId } from '@extropy/contracts';

export class HouseholdService {
  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService,
  ) {}

  // ── Households ───────────────────────────────────────────────────────────

  async createHousehold(req: CreateHouseholdRequest): Promise<Household> {
    const id = uuidv4() as HouseholdId;
    const now = new Date().toISOString();

    await this.db.query(
      `INSERT INTO hf_households
        (id, name, validator_id, address, timezone, area_sqft, energy_baseline_kwh, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id, req.name, req.validatorId, req.address ?? null,
        req.timezone ?? 'America/Chicago', req.area_sqft ?? null,
        req.energyBaselineKwh ?? null, now, now,
      ],
    );

    return {
      id,
      name: req.name,
      dfaoId: null,
      validatorId: req.validatorId as ValidatorId,
      memberValidatorIds: [req.validatorId as ValidatorId],
      address: req.address ?? null,
      timezone: req.timezone ?? 'America/Chicago',
      area_sqft: req.area_sqft ?? null,
      zoneIds: [],
      energyBaselineKwh: req.energyBaselineKwh ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getHousehold(id: string): Promise<Household | null> {
    const { rows } = await this.db.query('SELECT * FROM hf_households WHERE id = $1', [id]);
    return rows.length > 0 ? this.rowToHousehold(rows[0]) : null;
  }

  async listHouseholds(validatorId: string): Promise<Household[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM hf_households WHERE validator_id = $1 OR $1 = ANY(member_validator_ids) ORDER BY created_at DESC`,
      [validatorId],
    );
    return rows.map(this.rowToHousehold);
  }

  async updateHousehold(id: string, updates: Partial<Household>): Promise<Household | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
    if (updates.dfaoId !== undefined) { fields.push(`dfao_id = $${idx++}`); values.push(updates.dfaoId); }
    if (updates.address !== undefined) { fields.push(`address = $${idx++}`); values.push(updates.address); }
    if (updates.timezone !== undefined) { fields.push(`timezone = $${idx++}`); values.push(updates.timezone); }
    if (updates.area_sqft !== undefined) { fields.push(`area_sqft = $${idx++}`); values.push(updates.area_sqft); }
    if (updates.energyBaselineKwh !== undefined) { fields.push(`energy_baseline_kwh = $${idx++}`); values.push(updates.energyBaselineKwh); }

    if (fields.length === 0) return this.getHousehold(id);

    fields.push('updated_at = NOW()');
    values.push(id);

    const { rows } = await this.db.query(
      `UPDATE hf_households SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return rows.length > 0 ? this.rowToHousehold(rows[0]) : null;
  }

  async deleteHousehold(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query('DELETE FROM hf_households WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  // ── Zones ────────────────────────────────────────────────────────────────

  async createZone(req: CreateZoneRequest): Promise<Zone> {
    const id = uuidv4() as ZoneId;
    const now = new Date().toISOString();

    await this.db.query(
      `INSERT INTO hf_zones
        (id, household_id, name, floor, area_sqft, target_temperature_f, target_humidity_pct, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id, req.householdId, req.name, req.floor, req.area_sqft,
        req.targetTemperatureF ?? null, req.targetHumidityPct ?? null, now, now,
      ],
    );

    // Update household zone list
    await this.db.query(
      `UPDATE hf_households SET zone_ids = array_append(zone_ids, $1), updated_at = NOW() WHERE id = $2`,
      [id, req.householdId],
    );

    return {
      id,
      householdId: req.householdId as HouseholdId,
      name: req.name,
      floor: req.floor,
      area_sqft: req.area_sqft,
      deviceIds: [],
      targetTemperatureF: req.targetTemperatureF ?? null,
      targetHumidityPct: req.targetHumidityPct ?? null,
      isOccupied: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getZone(id: string): Promise<Zone | null> {
    const { rows } = await this.db.query('SELECT * FROM hf_zones WHERE id = $1', [id]);
    return rows.length > 0 ? this.rowToZone(rows[0]) : null;
  }

  async listZones(householdId: string): Promise<Zone[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM hf_zones WHERE household_id = $1 ORDER BY floor, name',
      [householdId],
    );
    return rows.map(this.rowToZone);
  }

  async updateZoneOccupancy(zoneId: string, isOccupied: boolean): Promise<void> {
    await this.db.query(
      'UPDATE hf_zones SET is_occupied = $1, updated_at = NOW() WHERE id = $2',
      [isOccupied, zoneId],
    );
  }

  async deleteZone(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query('DELETE FROM hf_zones WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private rowToHousehold(row: Record<string, unknown>): Household {
    return {
      id: row.id as HouseholdId,
      name: row.name as string,
      dfaoId: row.dfao_id as DFAOId | null,
      validatorId: row.validator_id as ValidatorId,
      memberValidatorIds: (row.member_validator_ids as string[]).map(v => v as ValidatorId),
      address: row.address as string | null,
      timezone: row.timezone as string,
      area_sqft: row.area_sqft as number | null,
      zoneIds: (row.zone_ids as string[]).map(z => z as ZoneId),
      energyBaselineKwh: row.energy_baseline_kwh as number | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private rowToZone(row: Record<string, unknown>): Zone {
    return {
      id: row.id as ZoneId,
      householdId: row.household_id as HouseholdId,
      name: row.name as string,
      floor: row.floor as number,
      area_sqft: row.area_sqft as number,
      deviceIds: (row.device_ids as string[] ?? []).map(d => d as any),
      targetTemperatureF: row.target_temperature_f as number | null,
      targetHumidityPct: row.target_humidity_pct as number | null,
      isOccupied: row.is_occupied as boolean,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
