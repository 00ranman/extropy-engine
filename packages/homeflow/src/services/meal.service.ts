/**
 * HomeFlow — Meal Service
 *
 * Meal planning, nutrition analysis, prep tracking, and XP calculation.
 * Ported from standalone homeflow_service.py meal endpoints.
 * Uses PostgreSQL hf_meal_plans, hf_meal_prep_sessions tables (migration 003).
 *
 * XP Formula: Meal_XP = base_entropy x nutrition_score x complexity x
 *   satisfaction x waste_reduction x time_efficiency x cost_effectiveness
 *
 * Ref: https://github.com/00ranman/extropy-engine/issues/5
 */
import { DatabaseService } from './database.service.js';
import { EventBusService } from './event-bus.service.js';
import { EventType } from '@extropy/contracts';
import { v4 as uuidv4 } from 'uuid';

export interface MealPlan {
  id: string;
  household_id: string;
  meal_type: string;
  name: string;
  ingredients: string[];
  nutrition_score: number;
  cost_estimate: number;
  prep_time_minutes: number;
  planned_date: Date;
  servings: number;
  dietary_tags?: string[];
  created_at: Date;
}

export interface MealPrepSession {
  id: string;
  meal_plan_id: string;
  household_id: string;
  prepared_by: string;
  actual_time_minutes: number;
  quality_score: number;
  waste_percentage: number;
  notes?: string;
  xp_earned: number;
  completed_at: Date;
}

export class MealService {
  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService
  ) {}

  async getPlans(householdId: string, days: number = 7): Promise<MealPlan[]> {
    const result = await this.db.query(
      `SELECT * FROM hf_meal_plans
       WHERE household_id = $1
         AND planned_date >= NOW() - INTERVAL '1 day' * $2
       ORDER BY planned_date, meal_type`,
      [householdId, days]
    );
    return result.rows;
  }

  async createPlan(householdId: string, data: Partial<MealPlan>): Promise<MealPlan> {
    const id = uuidv4();
    const result = await this.db.query(
      `INSERT INTO hf_meal_plans (
        id, household_id, meal_type, name, ingredients, nutrition_score,
        cost_estimate, prep_time_minutes, planned_date, servings, dietary_tags
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        id, householdId,
        data.meal_type || 'dinner',
        data.name,
        JSON.stringify(data.ingredients || []),
        data.nutrition_score || 0.7,
        data.cost_estimate || 0,
        data.prep_time_minutes || 30,
        data.planned_date || new Date(),
        data.servings || 4,
        JSON.stringify(data.dietary_tags || [])
      ]
    );
    await this.eventBus.publish(EventType.CLAIM_SUBMITTED, {
      source: 'homeflow', action: 'meal.plan_created',
      householdId, mealPlanId: id, deltaS: 0.15
    });
    return result.rows[0];
  }

  async getNutritionAnalysis(
    householdId: string, days: number = 7
  ): Promise<Record<string, unknown>> {
    const result = await this.db.query(
      `SELECT meal_type, AVG(nutrition_score) as avg_nutrition,
              COUNT(*) as meal_count, AVG(cost_estimate) as avg_cost
       FROM hf_meal_plans
       WHERE household_id = $1 AND planned_date >= NOW() - INTERVAL '1 day' * $2
       GROUP BY meal_type`,
      [householdId, days]
    );
    return { period_days: days, by_meal_type: result.rows };
  }

  async trackPrepSession(
    householdId: string, data: Partial<MealPrepSession>
  ): Promise<MealPrepSession> {
    const id = uuidv4();
    const xp = this.calculateMealXP({
      baseEntropy: 8,
      nutritionScore: data.quality_score || 0.7,
      complexity: 1.0,
      satisfaction: data.quality_score || 0.8,
      wasteReduction: 1 - (data.waste_percentage || 0) / 100,
      timeEfficiency: 1.0,
      costEffectiveness: 1.0
    });
    const result = await this.db.query(
      `INSERT INTO hf_meal_prep_sessions (
        id, meal_plan_id, household_id, prepared_by,
        actual_time_minutes, quality_score, waste_percentage,
        notes, xp_earned
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        id, data.meal_plan_id, householdId, data.prepared_by,
        data.actual_time_minutes || 0, data.quality_score || 0.8,
        data.waste_percentage || 0, data.notes, xp
      ]
    );
    await this.eventBus.publish(EventType.CLAIM_SUBMITTED, {
      source: 'homeflow', action: 'meal.prep_completed',
      householdId, prepSessionId: id, xpEarned: xp, deltaS: 0.2
    });
    return result.rows[0];
  }

  async getSuggestions(
    householdId: string
  ): Promise<Record<string, unknown>[]> {
    // Pull recent meal history to avoid repeats
    const recent = await this.db.query(
      `SELECT DISTINCT name FROM hf_meal_plans
       WHERE household_id = $1
         AND planned_date >= NOW() - INTERVAL '14 days'
       ORDER BY name`,
      [householdId]
    );
    const recentNames = recent.rows.map((r: { name: string }) => r.name);
    return [
      { type: 'variety', message: 'Consider meals not made recently', exclude: recentNames },
      { type: 'nutrition', message: 'Balance protein and vegetables across the week' },
      { type: 'cost', message: 'Batch-cook grains to reduce per-meal cost' }
    ];
  }

  private calculateMealXP(p: {
    baseEntropy: number; nutritionScore: number; complexity: number;
    satisfaction: number; wasteReduction: number; timeEfficiency: number;
    costEffectiveness: number;
  }): number {
    const xp = p.baseEntropy * p.nutritionScore * p.complexity *
               p.satisfaction * p.wasteReduction * p.timeEfficiency * p.costEffectiveness;
    return Math.round(xp * 100) / 100;
  }
}
