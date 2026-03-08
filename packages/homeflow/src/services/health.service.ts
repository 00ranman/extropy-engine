/**
 * HomeFlow — Health Service
 *
 * Family health profiles, wellness tracking, activity logging, and XP.
 * Ported from standalone homeflow_service.py health endpoints.
 * Uses PostgreSQL hf_health_profiles, hf_health_activities tables (migration 003).
 *
 * XP Formula: Health_XP = base_entropy x dietary_improvement x exercise_integration x
 *   family_wellness x long_term_impact
 *
 * Ref: https://github.com/00ranman/extropy-engine/issues/5
 */
import { DatabaseService } from './database.service.js';
import { EventBusService } from './event-bus.service.js';
import { EventType } from '@extropy/contracts';
import { v4 as uuidv4 } from 'uuid';

export interface HealthProfile {
  id: string;
  household_id: string;
  user_id: string;
  age?: number;
  activity_level: string;
  dietary_restrictions: string[];
  health_goals: string[];
  allergies: string[];
  nutrition_targets: Record<string, number>;
  updated_at: Date;
}

export interface HealthActivity {
  id: string;
  household_id: string;
  user_id: string;
  activity_type: string;
  description: string;
  duration_minutes: number;
  intensity: number;
  xp_earned: number;
  created_at: Date;
}

export class HealthService {
  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService
  ) {}

  async getProfiles(householdId: string): Promise<HealthProfile[]> {
    const result = await this.db.query(
      'SELECT * FROM hf_health_profiles WHERE household_id = $1 ORDER BY user_id',
      [householdId]
    );
    return result.rows.map((r: Record<string, unknown>) => ({
      ...r,
      dietary_restrictions: JSON.parse((r.dietary_restrictions as string) || '[]'),
      health_goals: JSON.parse((r.health_goals as string) || '[]'),
      allergies: JSON.parse((r.allergies as string) || '[]'),
      nutrition_targets: JSON.parse((r.nutrition_targets as string) || '{}')
    }));
  }

  async upsertProfile(householdId: string, userId: string, data: Partial<HealthProfile>): Promise<HealthProfile> {
    const id = uuidv4();
    const result = await this.db.query(
      `INSERT INTO hf_health_profiles (
        id, household_id, user_id, age, activity_level,
        dietary_restrictions, health_goals, allergies, nutrition_targets
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (household_id, user_id) DO UPDATE SET
        age = EXCLUDED.age,
        activity_level = EXCLUDED.activity_level,
        dietary_restrictions = EXCLUDED.dietary_restrictions,
        health_goals = EXCLUDED.health_goals,
        allergies = EXCLUDED.allergies,
        nutrition_targets = EXCLUDED.nutrition_targets,
        updated_at = NOW()
      RETURNING *`,
      [
        id, householdId, userId,
        data.age, data.activity_level || 'moderate',
        JSON.stringify(data.dietary_restrictions || []),
        JSON.stringify(data.health_goals || []),
        JSON.stringify(data.allergies || []),
        JSON.stringify(data.nutrition_targets || {})
      ]
    );
    return result.rows[0];
  }

  async trackActivity(householdId: string, userId: string, data: Partial<HealthActivity>): Promise<HealthActivity> {
    const id = uuidv4();
    const xp = this.calculateHealthXP({
      baseEntropy: 6,
      dietaryImprovement: 1.0,
      exerciseIntegration: (data.intensity || 5) / 10,
      familyWellness: 0.85,
      longTermImpact: 1.0
    });
    const result = await this.db.query(
      `INSERT INTO hf_health_activities (
        id, household_id, user_id, activity_type, description,
        duration_minutes, intensity, xp_earned
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        id, householdId, userId,
        data.activity_type || 'general',
        data.description || '',
        data.duration_minutes || 0,
        data.intensity || 5,
        xp
      ]
    );
    await this.eventBus.publish(EventType.CLAIM_SUBMITTED, {
      source: 'homeflow', action: 'health.activity_tracked',
      householdId, userId, activityId: id, xpEarned: xp, deltaS: 0.12
    });
    return result.rows[0];
  }

  async getRecommendations(householdId: string): Promise<Record<string, unknown>[]> {
    const profiles = await this.getProfiles(householdId);
    const recs: Record<string, unknown>[] = [];
    for (const p of profiles) {
      if (p.activity_level === 'sedentary') {
        recs.push({ userId: p.user_id, type: 'exercise', message: 'Increase daily movement to 30 min' });
      }
      if (p.health_goals.includes('weight_loss')) {
        recs.push({ userId: p.user_id, type: 'nutrition', message: 'Consider higher protein meals' });
      }
    }
    return recs;
  }

  private calculateHealthXP(p: {
    baseEntropy: number; dietaryImprovement: number; exerciseIntegration: number;
    familyWellness: number; longTermImpact: number;
  }): number {
    const xp = p.baseEntropy * p.dietaryImprovement * p.exerciseIntegration *
               p.familyWellness * p.longTermImpact;
    return Math.round(xp * 100) / 100;
  }
}
