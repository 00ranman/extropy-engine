/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HOMEFLOW — Domain Types
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  HomeFlow-specific types that extend the shared @extropy/contracts.
 *
 *  These types cover:
 *    - IoT device management (thermostats, sensors, HVAC, lighting, energy)
 *    - Home automation actions & commands
 *    - Thermodynamic entropy measurement from automation
 *    - HomeFlow-specific event payloads
 *    - Household DFAO structures
 *    - Seasonal & temporal automation patterns
 *    - HomeFlow token flows
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type {
  LoopId,
  ClaimId,
  ValidatorId,
  MeasurementId,
  DFAOId,
  SeasonId,
  VertexId,
  CredentialId,
  WalletId,
  Timestamp,
  EntropyDomain,
  EntropyMeasurement,
  DomainEvent,
  ServiceName,
} from '@extropy/contracts';

// ─────────────────────────────────────────────────────────────────────────────
//  HomeFlow Branded IDs
// ─────────────────────────────────────────────────────────────────────────────

export type DeviceId     = string & { readonly __brand: 'DeviceId' };
export type ZoneId       = string & { readonly __brand: 'ZoneId' };
export type ScheduleId   = string & { readonly __brand: 'ScheduleId' };
export type AutomationId = string & { readonly __brand: 'AutomationId' };
export type HouseholdId  = string & { readonly __brand: 'HouseholdId' };

// ─────────────────────────────────────────────────────────────────────────────
//  Device Types & Management
// ─────────────────────────────────────────────────────────────────────────────

export enum DeviceType {
  THERMOSTAT      = 'thermostat',
  TEMPERATURE_SENSOR = 'temperature_sensor',
  HUMIDITY_SENSOR = 'humidity_sensor',
  LIGHTING        = 'lighting',
  HVAC            = 'hvac',
  ENERGY_MONITOR  = 'energy_monitor',
  SMART_PLUG      = 'smart_plug',
  OCCUPANCY_SENSOR = 'occupancy_sensor',
  WATER_METER     = 'water_meter',
  SOLAR_PANEL     = 'solar_panel',
  BATTERY_STORAGE = 'battery_storage',
  AIR_QUALITY     = 'air_quality',
}

export enum DeviceStatus {
  ONLINE   = 'online',
  OFFLINE  = 'offline',
  ERROR    = 'error',
  PAIRING  = 'pairing',
  UPDATING = 'updating',
}

export interface DeviceCapability {
  name: string;
  type: 'read' | 'write' | 'readwrite';
  unit: string;
  min?: number;
  max?: number;
  enumValues?: string[];
}

export interface Device {
  id: DeviceId;
  householdId: HouseholdId;
  zoneId: ZoneId | null;
  name: string;
  type: DeviceType;
  manufacturer: string;
  model: string;
  firmwareVersion: string;
  status: DeviceStatus;
  capabilities: DeviceCapability[];
  state: DeviceState;
  metadata: Record<string, unknown>;
  lastSeenAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DeviceState {
  [key: string]: unknown;
  /** Current power consumption in watts */
  powerWatts?: number;
  /** Current temperature in Fahrenheit */
  temperatureF?: number;
  /** Temperature setpoint in Fahrenheit */
  setpointF?: number;
  /** Humidity percentage */
  humidityPct?: number;
  /** Brightness level 0-100 */
  brightnessPct?: number;
  /** On/off state */
  isOn?: boolean;
  /** HVAC mode */
  hvacMode?: 'heat' | 'cool' | 'auto' | 'off' | 'fan_only';
  /** Fan speed */
  fanSpeed?: 'auto' | 'low' | 'medium' | 'high';
  /** Energy generated in Wh (for solar) */
  energyGeneratedWh?: number;
  /** Battery charge percentage */
  batteryPct?: number;
  /** Air quality index */
  airQualityIndex?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Zones & Households
// ─────────────────────────────────────────────────────────────────────────────

export interface Zone {
  id: ZoneId;
  householdId: HouseholdId;
  name: string;
  floor: number;
  area_sqft: number;
  deviceIds: DeviceId[];
  targetTemperatureF: number | null;
  targetHumidityPct: number | null;
  isOccupied: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Household {
  id: HouseholdId;
  name: string;
  dfaoId: DFAOId | null;
  validatorId: ValidatorId;
  memberValidatorIds: ValidatorId[];
  address: string | null;
  timezone: string;
  area_sqft: number | null;
  zoneIds: ZoneId[];
  energyBaselineKwh: number | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Commands & Actions
// ─────────────────────────────────────────────────────────────────────────────

export enum CommandType {
  SET_TEMPERATURE   = 'set_temperature',
  SET_BRIGHTNESS    = 'set_brightness',
  SET_HVAC_MODE     = 'set_hvac_mode',
  SET_FAN_SPEED     = 'set_fan_speed',
  TOGGLE_POWER      = 'toggle_power',
  SET_SCHEDULE      = 'set_schedule',
  TRIGGER_SCENE     = 'trigger_scene',
}

export enum CommandStatus {
  PENDING   = 'pending',
  SENT      = 'sent',
  CONFIRMED = 'confirmed',
  FAILED    = 'failed',
  TIMEOUT   = 'timeout',
}

export interface DeviceCommand {
  id: string;
  deviceId: DeviceId;
  type: CommandType;
  parameters: Record<string, unknown>;
  status: CommandStatus;
  issuedBy: ValidatorId;
  issuedAt: Timestamp;
  confirmedAt: Timestamp | null;
  previousState: Partial<DeviceState>;
  newState: Partial<DeviceState>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Automation Schedules
// ─────────────────────────────────────────────────────────────────────────────

export enum ScheduleType {
  TIME_BASED  = 'time_based',
  OCCUPANCY   = 'occupancy',
  SEASONAL    = 'seasonal',
  SOLAR_AWARE = 'solar_aware',
  PRICE_AWARE = 'price_aware',
}

export interface AutomationSchedule {
  id: ScheduleId;
  householdId: HouseholdId;
  name: string;
  type: ScheduleType;
  enabled: boolean;
  /** Cron expression for time-based schedules */
  cronExpression: string | null;
  /** Season context (links to temporal service) */
  seasonId: SeasonId | null;
  /** Conditions that must be true for execution */
  conditions: ScheduleCondition[];
  /** Actions to execute when triggered */
  actions: ScheduleAction[];
  /** Historical entropy savings from this schedule */
  cumulativeDeltaS: number;
  lastTriggeredAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ScheduleCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
  value: unknown;
}

export interface ScheduleAction {
  deviceId: DeviceId;
  commandType: CommandType;
  parameters: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Entropy Measurement — HomeFlow specifics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HomeFlow measures thermodynamic entropy in three dimensions:
 *   1. Energy consumption: kWh saved → ΔS = ΔQ/T (Joules/Kelvin)
 *   2. Temperature optimization: reduced deviation from setpoint
 *   3. Resource efficiency: water, gas, solar utilization
 */
export interface HomeEntropySnapshot {
  householdId: HouseholdId;
  timestamp: Timestamp;
  /** Total power consumption in Watts at snapshot time */
  totalPowerWatts: number;
  /** Energy consumed since last snapshot in Wh */
  energyConsumedWh: number;
  /** Average indoor temperature in Fahrenheit */
  avgIndoorTempF: number;
  /** Outdoor temperature in Fahrenheit (from weather API or sensor) */
  outdoorTempF: number | null;
  /** Average humidity percentage */
  avgHumidityPct: number;
  /** Solar generation in Wh (if applicable) */
  solarGeneratedWh: number;
  /** Number of occupied zones */
  occupiedZones: number;
  /** Total zones */
  totalZones: number;
  /** Raw computed entropy in J/K */
  entropyJoulePerKelvin: number;
}

export interface HomeEntropyReduction {
  householdId: HouseholdId;
  before: HomeEntropySnapshot;
  after: HomeEntropySnapshot;
  /** ΔS in J/K — must be > 0 for XP to mint */
  deltaS: number;
  /** Breakdown of how ΔS was achieved */
  breakdown: {
    energySavingsJK: number;
    temperatureOptimizationJK: number;
    resourceEfficiencyJK: number;
  };
  /** The automation action(s) that caused the reduction */
  causalCommandIds: string[];
  /** Measurement confidence (0-1) based on sensor quality */
  confidence: number;
  measuredAt: Timestamp;
}

// ─────────────────────────────────────────────────────────────────────────────
//  HomeFlow-Specific Event Types (extend contracts EventPayloadMap)
// ─────────────────────────────────────────────────────────────────────────────

export enum HomeFlowEventType {
  /** Device registered with HomeFlow */
  DEVICE_REGISTERED      = 'homeflow.device.registered',
  /** Device state changed (sensor reading or command confirmed) */
  DEVICE_STATE_CHANGED   = 'homeflow.device.state_changed',
  /** Device went offline */
  DEVICE_OFFLINE         = 'homeflow.device.offline',
  /** Command issued to a device */
  COMMAND_ISSUED         = 'homeflow.command.issued',
  /** Command confirmed by device */
  COMMAND_CONFIRMED      = 'homeflow.command.confirmed',
  /** Entropy snapshot taken */
  ENTROPY_SNAPSHOT       = 'homeflow.entropy.snapshot',
  /** Entropy reduction measured (ΔS > 0) */
  ENTROPY_REDUCTION      = 'homeflow.entropy.reduction',
  /** Claim auto-generated from entropy reduction */
  CLAIM_AUTO_GENERATED   = 'homeflow.claim.auto_generated',
  /** Automation schedule triggered */
  SCHEDULE_TRIGGERED     = 'homeflow.schedule.triggered',
  /** Household DFAO created */
  HOUSEHOLD_DFAO_CREATED = 'homeflow.household.dfao_created',
  /** Energy credit minted */
  ENERGY_CREDIT_MINTED   = 'homeflow.token.energy_credit',
  /** Household contribution token issued */
  HOUSEHOLD_CT_ISSUED    = 'homeflow.token.household_ct',
  /** Energy efficiency credential issued */
  EFFICIENCY_CREDENTIAL  = 'homeflow.credential.efficiency',
  /** Cross-domain entropy aggregation */
  CROSS_DOMAIN_AGGREGATE = 'homeflow.interop.cross_domain_aggregate',
  /** Seasonal pattern detected */
  SEASONAL_PATTERN       = 'homeflow.temporal.seasonal_pattern',
  /** Validation task received from SignalFlow */
  VALIDATION_TASK_RECEIVED = 'homeflow.task.validation_received',
  /** Validation task completed */
  VALIDATION_TASK_COMPLETED = 'homeflow.task.validation_completed',
}

// ── HomeFlow Event Payloads ──────────────────────────────────────────────────

export interface DeviceRegisteredPayload {
  device: Device;
  householdId: HouseholdId;
}

export interface DeviceStateChangedPayload {
  deviceId: DeviceId;
  previousState: Partial<DeviceState>;
  newState: Partial<DeviceState>;
  trigger: 'sensor_reading' | 'command' | 'automation' | 'manual';
}

export interface DeviceOfflinePayload {
  deviceId: DeviceId;
  lastSeenAt: Timestamp;
}

export interface CommandIssuedPayload {
  command: DeviceCommand;
}

export interface CommandConfirmedPayload {
  commandId: string;
  deviceId: DeviceId;
  confirmedAt: Timestamp;
  resultState: Partial<DeviceState>;
}

export interface EntropySnapshotPayload {
  snapshot: HomeEntropySnapshot;
}

export interface EntropyReductionPayload {
  reduction: HomeEntropyReduction;
  loopId: LoopId | null;
}

export interface ClaimAutoGeneratedPayload {
  claimId: ClaimId;
  loopId: LoopId;
  householdId: HouseholdId;
  deltaS: number;
  statement: string;
}

export interface ScheduleTriggeredPayload {
  scheduleId: ScheduleId;
  householdId: HouseholdId;
  commandsIssued: string[];
}

export interface HouseholdDFAOCreatedPayload {
  householdId: HouseholdId;
  dfaoId: DFAOId;
  founderValidatorId: ValidatorId;
}

export interface EnergyCreditMintedPayload {
  householdId: HouseholdId;
  validatorId: ValidatorId;
  amount: number;
  loopId: LoopId;
  deltaS: number;
}

export interface HouseholdCTIssuedPayload {
  householdId: HouseholdId;
  validatorId: ValidatorId;
  amount: number;
  contribution: string;
}

export interface EfficiencyCredentialPayload {
  householdId: HouseholdId;
  validatorId: ValidatorId;
  credentialId: CredentialId;
  level: 'bronze' | 'silver' | 'gold' | 'platinum';
  cumulativeDeltaS: number;
}

export interface CrossDomainAggregatePayload {
  householdId: HouseholdId;
  sourceApp: string;
  sourceDomain: EntropyDomain;
  sourceDeltaS: number;
  homeflowDeltaS: number;
  compositeDeltaS: number;
  compositeXP: number;
}

export interface SeasonalPatternPayload {
  householdId: HouseholdId;
  seasonId: SeasonId;
  pattern: 'heating_increase' | 'cooling_increase' | 'baseline_shift' | 'solar_peak' | 'occupancy_shift';
  detectedAt: Timestamp;
  recommendedActions: ScheduleAction[];
}

export interface ValidationTaskReceivedPayload {
  taskId: string;
  claimId: ClaimId;
  loopId: LoopId;
  fromService: string;
  entropyDomain: EntropyDomain;
}

export interface ValidationTaskCompletedPayload {
  taskId: string;
  claimId: ClaimId;
  verdict: 'confirmed' | 'denied' | 'insufficient_evidence';
  confidence: number;
  justification: string;
}

// ── HomeFlow Event Payload Map ───────────────────────────────────────────────

export interface HomeFlowEventPayloadMap {
  [HomeFlowEventType.DEVICE_REGISTERED]:        DeviceRegisteredPayload;
  [HomeFlowEventType.DEVICE_STATE_CHANGED]:      DeviceStateChangedPayload;
  [HomeFlowEventType.DEVICE_OFFLINE]:            DeviceOfflinePayload;
  [HomeFlowEventType.COMMAND_ISSUED]:            CommandIssuedPayload;
  [HomeFlowEventType.COMMAND_CONFIRMED]:         CommandConfirmedPayload;
  [HomeFlowEventType.ENTROPY_SNAPSHOT]:          EntropySnapshotPayload;
  [HomeFlowEventType.ENTROPY_REDUCTION]:         EntropyReductionPayload;
  [HomeFlowEventType.CLAIM_AUTO_GENERATED]:      ClaimAutoGeneratedPayload;
  [HomeFlowEventType.SCHEDULE_TRIGGERED]:        ScheduleTriggeredPayload;
  [HomeFlowEventType.HOUSEHOLD_DFAO_CREATED]:    HouseholdDFAOCreatedPayload;
  [HomeFlowEventType.ENERGY_CREDIT_MINTED]:      EnergyCreditMintedPayload;
  [HomeFlowEventType.HOUSEHOLD_CT_ISSUED]:       HouseholdCTIssuedPayload;
  [HomeFlowEventType.EFFICIENCY_CREDENTIAL]:     EfficiencyCredentialPayload;
  [HomeFlowEventType.CROSS_DOMAIN_AGGREGATE]:    CrossDomainAggregatePayload;
  [HomeFlowEventType.SEASONAL_PATTERN]:          SeasonalPatternPayload;
  [HomeFlowEventType.VALIDATION_TASK_RECEIVED]:  ValidationTaskReceivedPayload;
  [HomeFlowEventType.VALIDATION_TASK_COMPLETED]: ValidationTaskCompletedPayload;
}

// ─────────────────────────────────────────────────────────────────────────────
//  API Request/Response Shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface RegisterDeviceRequest {
  householdId: string;
  name: string;
  type: DeviceType;
  manufacturer: string;
  model: string;
  firmwareVersion: string;
  zoneId?: string;
  capabilities?: DeviceCapability[];
  metadata?: Record<string, unknown>;
}

export interface IssueCommandRequest {
  commandType: CommandType;
  parameters: Record<string, unknown>;
  issuedBy: string;
}

export interface CreateZoneRequest {
  householdId: string;
  name: string;
  floor: number;
  area_sqft: number;
  targetTemperatureF?: number;
  targetHumidityPct?: number;
}

export interface CreateHouseholdRequest {
  name: string;
  validatorId: string;
  address?: string;
  timezone?: string;
  area_sqft?: number;
  energyBaselineKwh?: number;
}

export interface CreateScheduleRequest {
  householdId: string;
  name: string;
  type: ScheduleType;
  cronExpression?: string;
  seasonId?: string;
  conditions?: ScheduleCondition[];
  actions: ScheduleAction[];
}

export interface IncomingWebhookEvent {
  eventId: string;
  type: string;
  source: string;
  payload: Record<string, unknown>;
  correlationId: string;
  timestamp: string;
  version: number;
}
