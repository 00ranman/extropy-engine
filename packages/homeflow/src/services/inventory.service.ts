/**
 * HomeFlow — Inventory Service
 * 
 * CRUD + low-stock detection + barcode lookup for household inventory.
 * Ported from standalone homeflow_service.py inventory endpoints.
 * Uses PostgreSQL hf_inventory table (migration 003).
 * 
 * Ref: https://github.com/00ranman/extropy-engine/issues/5
 */

import { DatabaseService } from './database.service.js';
import { EventBusService } from './event-bus.service.js';
import { EventType } from '@extropy/contracts';
import { v4 as uuidv4 } from 'uuid';

export interface InventoryItem {
  id: string;
  household_id: string;
  name: string;
  category: string;
  subcategory?: string;
  quantity: number;
  unit: string;
  location?: string;
  expiration_date?: Date;
  reorder_level: number;
  brand?: string;
  cost?: number;
  barcode?: string;
  created_at: Date;
  updated_at: Date;
}

export interface InventoryFilter {
  household_id: string;
  category?: string;
  location?: string;
  low_stock_only?: boolean;
}

export class InventoryService {
  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService
  ) {}

  async getAll(filter: InventoryFilter): Promise<InventoryItem[]> {
    let query = 'SELECT * FROM hf_inventory WHERE household_id = $1';
    const params: unknown[] = [filter.household_id];
    let idx = 2;

    if (filter.category) {
      query += ` AND category = $${idx++}`;
      params.push(filter.category);
    }
    if (filter.location) {
      query += ` AND location = $${idx++}`;
      params.push(filter.location);
    }
    if (filter.low_stock_only) {
      query += ' AND quantity <= reorder_level';
    }
    query += ' ORDER BY category, name';

    const result = await this.db.query(query, params);
    return result.rows;
  }

  async getById(id: string, householdId: string): Promise<InventoryItem | null> {
    const result = await this.db.query(
      'SELECT * FROM hf_inventory WHERE id = $1 AND household_id = $2',
      [id, householdId]
    );
    return result.rows[0] || null;
  }

  async create(householdId: string, data: Partial<InventoryItem>): Promise<InventoryItem> {
    const id = uuidv4();
    const result = await this.db.query(
      `INSERT INTO hf_inventory (
        id, household_id, name, category, subcategory, quantity, unit,
        location, expiration_date, reorder_level, brand, cost, barcode
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [
        id, householdId, data.name, data.category || 'General',
        data.subcategory, data.quantity || 0, data.unit || 'units',
        data.location, data.expiration_date, data.reorder_level ?? 2,
        data.brand, data.cost, data.barcode
      ]
    );

    const item = result.rows[0];

    // Emit event for ecosystem integration
    await this.eventBus.publish(EventType.CLAIM_SUBMITTED, {
      source: 'homeflow',
      action: 'inventory.item_added',
      householdId,
      itemId: id,
      category: data.category,
      deltaS: 0.1 // small entropy reduction for organization
    });

    return item;
  }

  async update(id: string, householdId: string, data: Partial<InventoryItem>): Promise<InventoryItem | null> {
    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    const updatable = ['name','category','subcategory','quantity','unit','location',
      'expiration_date','reorder_level','brand','cost','barcode'] as const;

    for (const field of updatable) {
      if (data[field] !== undefined) {
        fields.push(`${field} = $${idx++}`);
        params.push(data[field]);
      }
    }
    if (fields.length === 0) return this.getById(id, householdId);

    fields.push(`updated_at = NOW()`);
    params.push(id, householdId);

    const result = await this.db.query(
      `UPDATE hf_inventory SET ${fields.join(', ')} WHERE id = $${idx++} AND household_id = $${idx} RETURNING *`,
      params
    );

    const item = result.rows[0];
    if (item) {
      await this.eventBus.publish(EventType.CLAIM_SUBMITTED, {
        source: 'homeflow',
        action: 'inventory.item_updated',
        householdId,
        itemId: id,
        deltaS: 0.05
      });
    }
    return item || null;
  }

  async delete(id: string, householdId: string): Promise<boolean> {
    const result = await this.db.query(
      'DELETE FROM hf_inventory WHERE id = $1 AND household_id = $2',
      [id, householdId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getLowStock(householdId: string): Promise<(InventoryItem & { urgency: string })[]> {
    const result = await this.db.query(
      `SELECT *,
        CASE WHEN quantity <= reorder_level * 0.5 THEN 'high' ELSE 'medium' END as urgency
      FROM hf_inventory
      WHERE household_id = $1 AND quantity <= reorder_level
      ORDER BY urgency DESC, category, name`,
      [householdId]
    );
    return result.rows;
  }

  async findByBarcode(barcode: string, householdId: string): Promise<InventoryItem | null> {
    const result = await this.db.query(
      'SELECT * FROM hf_inventory WHERE barcode = $1 AND household_id = $2',
      [barcode, householdId]
    );
    return result.rows[0] || null;
  }
}
