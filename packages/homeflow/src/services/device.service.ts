/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Device Management Service
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  CRUD for smart home devices, state tracking, and command interface.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuidv4 } from 'uuid';
import type { DatabaseService } from './database.service.js';
import type { EventBusService } from './event-bus.service.js';
import {
  type Device,
  type DeviceId,
  type DeviceState,
  type DeviceCommand,
  type HouseholdId,
  type ZoneId,
  type RegisterDeviceRequest,
  type IssueCommandRequest,
  DeviceStatus,
  DeviceType,
  CommandType,
  CommandStatus,
  HomeFlowEventType,
} from '../types/index.js';
import type { ValidatorId } from '@extropy/contracts';

export class DeviceService {
  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService,
  ) {}

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async registerDevice(req: RegisterDeviceRequest): Promise<Device> {
    const id = uuidv4() as DeviceId;
    const now = new Date().toISOString();
    const capabilities = req.capabilities ?? [];
    const metadata = req.metadata ?? {};

    const initialState: DeviceState = {};
    // Set type-appropriate defaults
    switch (req.type) {
      case DeviceType.THERMOSTAT:
        initialState.temperatureF = 72;
        initialState.setpointF = 72;
        initialState.hvacMode = 'auto';
        initialState.isOn = true;
        break;
      case DeviceType.LIGHTING:
        initialState.isOn = false;
        initialState.brightnessPct = 0;
        break;
      case DeviceType.HVAC:
        initialState.isOn = true;
        initialState.hvacMode = 'auto';
        initialState.fanSpeed = 'auto';
        initialState.powerWatts = 0;
        break;
      case DeviceType.ENERGY_MONITOR:
        initialState.powerWatts = 0;
        break;
      case DeviceType.SMART_PLUG:
        initialState.isOn = false;
        initialState.powerWatts = 0;
        break;
      default:
        break;
    }

    await this.db.query(
      `INSERT INTO hf_devices
        (id, household_id, zone_id, name, type, manufacturer, model, firmware_version,
         status, capabilities, state, metadata, last_seen_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id, req.householdId, req.zoneId ?? null, req.name, req.type,
        req.manufacturer, req.model, req.firmwareVersion,
        DeviceStatus.ONLINE, JSON.stringify(capabilities),
        JSON.stringify(initialState), JSON.stringify(metadata),
        now, now, now,
      ],
    );

    // Update zone device list if assigned
    if (req.zoneId) {
      await this.db.query(
        `UPDATE hf_zones SET device_ids = array_append(device_ids, $1), updated_at = NOW() WHERE id = $2`,
        [id, req.zoneId],
      );
    }

    const device: Device = {
      id,
      householdId: req.householdId as HouseholdId,
      zoneId: (req.zoneId as ZoneId) ?? null,
      name: req.name,
      type: req.type,
      manufacturer: req.manufacturer,
      model: req.model,
      firmwareVersion: req.firmwareVersion,
      status: DeviceStatus.ONLINE,
      capabilities,
      state: initialState,
      metadata,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await this.eventBus.publish(
      HomeFlowEventType.DEVICE_REGISTERED,
      req.householdId,
      { device, householdId: req.householdId as HouseholdId },
    );

    return device;
  }

  async getDevice(id: string): Promise<Device | null> {
    const { rows } = await this.db.query('SELECT * FROM hf_devices WHERE id = $1', [id]);
    return rows.length > 0 ? this.rowToDevice(rows[0]) : null;
  }

  async listDevices(householdId: string, type?: string): Promise<Device[]> {
    let query = 'SELECT * FROM hf_devices WHERE household_id = $1';
    const params: unknown[] = [householdId];
    if (type) {
      query += ' AND type = $2';
      params.push(type);
    }
    query += ' ORDER BY created_at DESC';
    const { rows } = await this.db.query(query, params);
    return rows.map(this.rowToDevice);
  }

  async updateDevice(id: string, updates: Partial<Device>): Promise<Device | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (updates.name !== undefined) { fields.push(`name = $${paramIdx++}`); values.push(updates.name); }
    if (updates.zoneId !== undefined) { fields.push(`zone_id = $${paramIdx++}`); values.push(updates.zoneId); }
    if (updates.status !== undefined) { fields.push(`status = $${paramIdx++}`); values.push(updates.status); }
    if (updates.state !== undefined) { fields.push(`state = $${paramIdx++}`); values.push(JSON.stringify(updates.state)); }
    if (updates.metadata !== undefined) { fields.push(`metadata = $${paramIdx++}`); values.push(JSON.stringify(updates.metadata)); }
    if (updates.firmwareVersion !== undefined) { fields.push(`firmware_version = $${paramIdx++}`); values.push(updates.firmwareVersion); }

    if (fields.length === 0) return this.getDevice(id);

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await this.db.query(
      `UPDATE hf_devices SET ${fields.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values,
    );
    return rows.length > 0 ? this.rowToDevice(rows[0]) : null;
  }

  async deleteDevice(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query('DELETE FROM hf_devices WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  async issueCommand(deviceId: string, req: IssueCommandRequest): Promise<DeviceCommand> {
    const device = await this.getDevice(deviceId);
    if (!device) throw new Error(`Device ${deviceId} not found`);

    const commandId = uuidv4();
    const now = new Date().toISOString();
    const previousState = { ...device.state };

    // Compute new state based on command
    const newState: Partial<DeviceState> = {};
    switch (req.commandType) {
      case CommandType.SET_TEMPERATURE:
        newState.setpointF = req.parameters.temperatureF as number;
        break;
      case CommandType.SET_BRIGHTNESS:
        newState.brightnessPct = req.parameters.brightnessPct as number;
        newState.isOn = (req.parameters.brightnessPct as number) > 0;
        break;
      case CommandType.SET_HVAC_MODE:
        newState.hvacMode = req.parameters.mode as DeviceState['hvacMode'];
        break;
      case CommandType.SET_FAN_SPEED:
        newState.fanSpeed = req.parameters.speed as DeviceState['fanSpeed'];
        break;
      case CommandType.TOGGLE_POWER:
        newState.isOn = req.parameters.on as boolean;
        break;
      default:
        break;
    }

    await this.db.query(
      `INSERT INTO hf_commands
        (id, device_id, type, parameters, status, issued_by, issued_at, previous_state, new_state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        commandId, deviceId, req.commandType,
        JSON.stringify(req.parameters), CommandStatus.PENDING,
        req.issuedBy, now,
        JSON.stringify(previousState), JSON.stringify(newState),
      ],
    );

    // Simulate immediate confirmation (in production, wait for device ACK)
    await this.confirmCommand(commandId, newState);

    const command: DeviceCommand = {
      id: commandId,
      deviceId: deviceId as DeviceId,
      type: req.commandType,
      parameters: req.parameters,
      status: CommandStatus.CONFIRMED,
      issuedBy: req.issuedBy as ValidatorId,
      issuedAt: now,
      confirmedAt: new Date().toISOString(),
      previousState,
      newState,
    };

    await this.eventBus.publish(
      HomeFlowEventType.COMMAND_ISSUED,
      device.householdId,
      { command },
    );

    return command;
  }

  async confirmCommand(commandId: string, resultState: Partial<DeviceState>): Promise<void> {
    const now = new Date().toISOString();

    const { rows } = await this.db.query(
      `UPDATE hf_commands SET status = $1, confirmed_at = $2, new_state = $3 WHERE id = $4 RETURNING *`,
      [CommandStatus.CONFIRMED, now, JSON.stringify(resultState), commandId],
    );

    if (rows.length > 0) {
      const cmd = rows[0];
      // Apply state to device
      await this.db.query(
        `UPDATE hf_devices SET state = state || $1::jsonb, last_seen_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(resultState), cmd.device_id],
      );

      // Get device for event emission
      const device = await this.getDevice(cmd.device_id);
      if (device) {
        await this.eventBus.publish(
          HomeFlowEventType.DEVICE_STATE_CHANGED,
          device.householdId,
          {
            deviceId: cmd.device_id as DeviceId,
            previousState: cmd.previous_state,
            newState: resultState,
            trigger: 'command',
          },
        );
      }
    }
  }

  async getCommandHistory(deviceId: string, limit = 50): Promise<DeviceCommand[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM hf_commands WHERE device_id = $1 ORDER BY issued_at DESC LIMIT $2',
      [deviceId, limit],
    );
    return rows.map(this.rowToCommand);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private rowToDevice(row: Record<string, unknown>): Device {
    return {
      id: row.id as DeviceId,
      householdId: row.household_id as HouseholdId,
      zoneId: row.zone_id as ZoneId | null,
      name: row.name as string,
      type: row.type as DeviceType,
      manufacturer: row.manufacturer as string,
      model: row.model as string,
      firmwareVersion: row.firmware_version as string,
      status: row.status as DeviceStatus,
      capabilities: row.capabilities as Device['capabilities'],
      state: row.state as DeviceState,
      metadata: row.metadata as Record<string, unknown>,
      lastSeenAt: row.last_seen_at as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private rowToCommand(row: Record<string, unknown>): DeviceCommand {
    return {
      id: row.id as string,
      deviceId: row.device_id as DeviceId,
      type: row.type as CommandType,
      parameters: row.parameters as Record<string, unknown>,
      status: row.status as CommandStatus,
      issuedBy: row.issued_by as ValidatorId,
      issuedAt: row.issued_at as string,
      confirmedAt: row.confirmed_at as string | null,
      previousState: row.previous_state as Partial<DeviceState>,
      newState: row.new_state as Partial<DeviceState>,
    };
  }
}
