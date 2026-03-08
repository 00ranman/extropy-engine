/**
 * HomeFlow — Shopping List Service
 *
 * Auto-generates shopping lists from low-stock inventory and meal plans.
 * Tracks order history and consumption forecasting.
 * Uses PostgreSQL hf_shopping_lists, hf_shopping_items, hf_orders tables (migration 003).
 *
 * Ref: https://github.com/00ranman/extropy-engine/issues/5
 */
import { DatabaseService } from './database.service.js';
import { EventBusService } from './event-bus.service.js';
import { EventType } from '@extropy/contracts';
import { v4 as uuidv4 } from 'uuid';

export interface ShoppingList {
  id: string;
  household_id: string;
  name: string;
  status: 'draft' | 'active' | 'ordered' | 'completed';
  items: ShoppingItem[];
  estimated_total: number;
  created_at: Date;
}

export interface ShoppingItem {
  id: string;
  list_id: string;
  inventory_item_id?: string;
  name: string;
  quantity: number;
  unit: string;
  estimated_cost: number;
  checked: boolean;
  source: 'low_stock' | 'meal_plan' | 'manual';
}

export class ShoppingListService {
  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService
  ) {}

  async generate(householdId: string): Promise<ShoppingList> {
    const listId = uuidv4();
    // Gather low-stock items
    const lowStock = await this.db.query(
      `SELECT id, name, unit, reorder_level - quantity as needed, cost
       FROM hf_inventory
       WHERE household_id = $1 AND quantity <= reorder_level
       ORDER BY category, name`,
      [householdId]
    );
    // Gather upcoming meal plan ingredients not in stock
    const mealIngredients = await this.db.query(
      `SELECT DISTINCT unnest(string_to_array(ingredients, ',')) as ingredient
       FROM hf_meal_plans
       WHERE household_id = $1
         AND planned_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'`,
      [householdId]
    );
    // Create list
    await this.db.query(
      `INSERT INTO hf_shopping_lists (id, household_id, name, status)
       VALUES ($1, $2, $3, 'draft')`,
      [listId, householdId, `Shopping ${new Date().toISOString().slice(0, 10)}`]
    );
    let estimatedTotal = 0;
    // Add low-stock items
    for (const row of lowStock.rows) {
      const itemId = uuidv4();
      const cost = (row.cost || 5) * Math.max(row.needed, 1);
      estimatedTotal += cost;
      await this.db.query(
        `INSERT INTO hf_shopping_items
         (id, list_id, inventory_item_id, name, quantity, unit, estimated_cost, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'low_stock')`,
        [itemId, listId, row.id, row.name, Math.max(row.needed, 1), row.unit, cost]
      );
    }
    // Add meal ingredients
    for (const row of mealIngredients.rows) {
      const itemId = uuidv4();
      await this.db.query(
        `INSERT INTO hf_shopping_items
         (id, list_id, name, quantity, unit, estimated_cost, source)
         VALUES ($1,$2,$3,1,'units',0,'meal_plan')`,
        [itemId, listId, row.ingredient?.trim()]
      );
    }
    await this.db.query(
      'UPDATE hf_shopping_lists SET estimated_total = $1 WHERE id = $2',
      [estimatedTotal, listId]
    );
    await this.eventBus.publish(EventType.CLAIM_SUBMITTED, {
      source: 'homeflow', action: 'shopping.list_generated',
      householdId, listId, itemCount: lowStock.rows.length + mealIngredients.rows.length,
      deltaS: 0.18
    });
    return this.getById(listId, householdId) as Promise<ShoppingList>;
  }

  async getById(listId: string, householdId: string): Promise<ShoppingList | null> {
    const listResult = await this.db.query(
      'SELECT * FROM hf_shopping_lists WHERE id = $1 AND household_id = $2',
      [listId, householdId]
    );
    if (!listResult.rows[0]) return null;
    const items = await this.db.query(
      'SELECT * FROM hf_shopping_items WHERE list_id = $1 ORDER BY name',
      [listId]
    );
    return { ...listResult.rows[0], items: items.rows };
  }

  async getActive(householdId: string): Promise<ShoppingList[]> {
    const result = await this.db.query(
      `SELECT * FROM hf_shopping_lists
       WHERE household_id = $1 AND status IN ('draft','active')
       ORDER BY created_at DESC`,
      [householdId]
    );
    return result.rows;
  }

  async checkItem(itemId: string, checked: boolean): Promise<void> {
    await this.db.query(
      'UPDATE hf_shopping_items SET checked = $1 WHERE id = $2',
      [checked, itemId]
    );
  }

  async getOrderHistory(householdId: string, limit: number = 20): Promise<Record<string, unknown>[]> {
    const result = await this.db.query(
      `SELECT * FROM hf_orders
       WHERE household_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [householdId, limit]
    );
    return result.rows;
  }
}
