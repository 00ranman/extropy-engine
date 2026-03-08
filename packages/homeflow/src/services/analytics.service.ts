/**
 * HomeFlow — Analytics Service
 *
 * Household dashboard, XP summaries, efficiency metrics.
 * Aggregates data from all other HomeFlow services.
 * Ported from standalone homeflow_service.py analytics endpoints.
 *
 * Ref: https://github.com/00ranman/extropy-engine/issues/5
 */
import { DatabaseService } from './database.service.js';

export interface DashboardData {
  inventorySummary: { category: string; totalItems: number; lowStock: number }[];
  taskSummary: { category: string; assigned: number; completed: number; avgQuality: number; totalXp: number }[];
  recentXp: { actionType: string; description: string; xpEarned: number; timestamp: string }[];
  householdHealthScore: number;
  efficiencyScore: number;
  familyCoordinationLevel: number;
}

export class AnalyticsService {
  constructor(private db: DatabaseService) {}

  async getDashboard(householdId: string, userId: string): Promise<DashboardData> {
    const [inv, tasks, xp] = await Promise.all([
      this.getInventorySummary(householdId),
      this.getTaskSummary(householdId),
      this.getRecentXp(householdId, userId)
    ]);
    return {
      inventorySummary: inv,
      taskSummary: tasks,
      recentXp: xp,
      householdHealthScore: await this.calcHealthScore(householdId),
      efficiencyScore: await this.calcEfficiency(householdId),
      familyCoordinationLevel: await this.calcCoordination(householdId)
    };
  }

  async getXpSummary(householdId: string): Promise<Record<string, unknown>> {
    const result = await this.db.query(
      `SELECT user_id, SUM(xp_earned) as total_xp, COUNT(*) as actions,
              AVG(xp_earned) as avg_xp
       FROM hf_xp_transactions
       WHERE household_id = $1
       GROUP BY user_id
       ORDER BY total_xp DESC`,
      [householdId]
    );
    return { leaderboard: result.rows };
  }

  async getEfficiencyMetrics(householdId: string): Promise<Record<string, unknown>> {
    const taskEff = await this.db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'completed') as completed,
              COUNT(*) as total,
              AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600) as avg_hours
       FROM hf_task_assignments
       WHERE household_id = $1
         AND created_at >= NOW() - INTERVAL '30 days'`,
      [householdId]
    );
    const mealEff = await this.db.query(
      `SELECT AVG(waste_percentage) as avg_waste,
              AVG(quality_score) as avg_quality
       FROM hf_meal_prep_sessions
       WHERE household_id = $1
         AND completed_at >= NOW() - INTERVAL '30 days'`,
      [householdId]
    );
    return {
      tasks: taskEff.rows[0] || {},
      meals: mealEff.rows[0] || {},
      period: '30d'
    };
  }

  private async getInventorySummary(householdId: string) {
    const result = await this.db.query(
      `SELECT category,
              COUNT(*) as total_items,
              COUNT(*) FILTER (WHERE quantity <= reorder_level) as low_stock
       FROM hf_inventory WHERE household_id = $1
       GROUP BY category ORDER BY category`,
      [householdId]
    );
    return result.rows.map((r: Record<string, unknown>) => ({
      category: r.category as string,
      totalItems: Number(r.total_items),
      lowStock: Number(r.low_stock)
    }));
  }

  private async getTaskSummary(householdId: string) {
    const result = await this.db.query(
      `SELECT t.category,
              COUNT(a.id) as assigned,
              COUNT(a.id) FILTER (WHERE a.status = 'completed') as completed,
              AVG(c.quality_score) as avg_quality,
              SUM(c.xp_earned) as total_xp
       FROM hf_tasks t
       LEFT JOIN hf_task_assignments a ON t.id = a.task_id
       LEFT JOIN hf_task_completions c ON a.id = c.assignment_id
       WHERE t.household_id = $1
       GROUP BY t.category`,
      [householdId]
    );
    return result.rows.map((r: Record<string, unknown>) => ({
      category: r.category as string,
      assigned: Number(r.assigned),
      completed: Number(r.completed),
      avgQuality: Number(r.avg_quality || 0),
      totalXp: Number(r.total_xp || 0)
    }));
  }

  private async getRecentXp(householdId: string, userId: string) {
    const result = await this.db.query(
      `SELECT action_type, description, xp_earned, created_at
       FROM hf_xp_transactions
       WHERE household_id = $1 AND user_id = $2
       ORDER BY created_at DESC LIMIT 10`,
      [householdId, userId]
    );
    return result.rows.map((r: Record<string, unknown>) => ({
      actionType: r.action_type as string,
      description: r.description as string,
      xpEarned: Number(r.xp_earned),
      timestamp: String(r.created_at)
    }));
  }

  private async calcHealthScore(householdId: string): Promise<number> {
    const result = await this.db.query(
      `SELECT
        (SELECT COUNT(*) FILTER (WHERE quantity > reorder_level)::float /
         NULLIF(COUNT(*), 0) FROM hf_inventory WHERE household_id = $1) as inv_health,
        (SELECT AVG(quality_score) FROM hf_task_completions c
         JOIN hf_task_assignments a ON c.assignment_id = a.id
         WHERE a.household_id = $1
           AND c.completed_at >= NOW() - INTERVAL '7 days') as task_quality`,
      [householdId]
    );
    const r = result.rows[0] || {};
    return Math.round(((Number(r.inv_health || 0.5) + Number(r.task_quality || 0.5)) / 2) * 100) / 100;
  }

  private async calcEfficiency(householdId: string): Promise<number> {
    const result = await this.db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'completed')::float /
              NULLIF(COUNT(*), 0) as rate
       FROM hf_task_assignments
       WHERE household_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`,
      [householdId]
    );
    return Number(result.rows[0]?.rate || 0.5);
  }

  private async calcCoordination(householdId: string): Promise<number> {
    const result = await this.db.query(
      `SELECT COUNT(DISTINCT assigned_to)::float /
              NULLIF((SELECT COUNT(DISTINCT user_id) FROM hf_health_profiles WHERE household_id = $1), 0) as ratio
       FROM hf_task_assignments
       WHERE household_id = $1 AND created_at >= NOW() - INTERVAL '7 days'`,
      [householdId]
    );
    return Math.min(Number(result.rows[0]?.ratio || 0.5), 1.0);
  }
}
