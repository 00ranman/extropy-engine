/**
 * HomeFlow — Chore Service
 * 
 * Task assignment, completion, skill matching, and XP calculation.
 * Ported from standalone homeflow_service.py chore endpoints.
 * Uses hf_tasks, hf_task_assignments, hf_task_completions tables (migration 003).
 * 
 * XP Formula: Chore_XP = base_entropy x difficulty x skill_bonus x quality x efficiency x consistency x family_impact
 * Ref: https://github.com/00ranman/extropy-engine/issues/5
 */

import { DatabaseService } from './database.service.js';
import { EventBusService } from './event-bus.service.js';
import { EventType } from '@extropy/contracts';
import { v4 as uuidv4 } from 'uuid';

export interface HouseholdTask {
  id: string;
  household_id: string;
  name: string;
  category: string;
  description?: string;
  difficulty: number;
  skill_requirements: string[];
  time_estimate?: number;
  frequency_days?: number;
  xp_base_reward: number;
  created_at: Date;
}

export interface TaskAssignment {
  id: string;
  task_id: string;
  assigned_to: string;
  assigned_by: string;
  due_date?: string;
  priority: string;
  status: string;
  notes?: string;
  created_at: Date;
}

export interface TaskCompletion {
  assignment_id: string;
  completed_by: string;
  quality_score: number;
  actual_duration?: number;
  skill_used?: string;
  notes?: string;
}

export class ChoreService {
  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService
  ) {}

  async getTasks(householdId: string, category?: string): Promise<HouseholdTask[]> {
    let query = 'SELECT * FROM hf_tasks WHERE household_id = $1';
    const params: unknown[] = [householdId];
    if (category) {
      query += ' AND category = $2';
      params.push(category);
    }
    query += ' ORDER BY category, difficulty, name';
    const result = await this.db.query(query, params);
    return result.rows;
  }

  async createTask(householdId: string, data: Partial<HouseholdTask>): Promise<HouseholdTask> {
    const id = uuidv4();
    const result = await this.db.query(
      `INSERT INTO hf_tasks (id, household_id, name, category, description, difficulty,
        skill_requirements, time_estimate, frequency_days, xp_base_reward)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id, householdId, data.name, data.category || 'general', data.description,
       data.difficulty || 1.0, data.skill_requirements || [], data.time_estimate,
       data.frequency_days, data.xp_base_reward || 10.0]
    );
    return result.rows[0];
  }

  async assignTask(data: { task_id: string; assigned_to: string; assigned_by: string;
    due_date?: string; priority?: string; notes?: string }): Promise<TaskAssignment> {
    const id = uuidv4();
    const result = await this.db.query(
      `INSERT INTO hf_task_assignments (id, task_id, assigned_to, assigned_by, due_date, priority, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, data.task_id, data.assigned_to, data.assigned_by,
       data.due_date, data.priority || 'normal', data.notes]
    );

    await this.eventBus.publish(EventType.TASK_CREATED, {
      source: 'homeflow',
      action: 'chore.assigned',
      assignmentId: id,
      taskId: data.task_id,
      assignedTo: data.assigned_to
    });

    return result.rows[0];
  }

  async completeTask(data: TaskCompletion): Promise<{ completionId: string; xpEarned: number }> {
    // Get assignment + task details
    const assignResult = await this.db.query(
      `SELECT ta.*, ht.name as task_name, ht.difficulty, ht.xp_base_reward, ht.time_estimate,
              ht.household_id, ht.category
       FROM hf_task_assignments ta
       JOIN hf_tasks ht ON ta.task_id = ht.id
       WHERE ta.id = $1 AND ta.status = 'pending'`,
      [data.assignment_id]
    );

    if (assignResult.rows.length === 0) {
      throw new Error('Assignment not found or already completed');
    }

    const assignment = assignResult.rows[0];
    const completionId = uuidv4();

    // Update assignment status
    await this.db.query(
      `UPDATE hf_task_assignments SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [data.assignment_id]
    );

    // Calculate XP using the formula from standalone
    const xpEarned = this.calculateChoreXP({
      baseEntropy: assignment.xp_base_reward,
      difficulty: assignment.difficulty,
      quality: data.quality_score,
      estimatedTime: assignment.time_estimate || 30,
      actualTime: data.actual_duration || assignment.time_estimate || 30,
      consistencyScore: 1.0,
      familyImpact: 1.0
    });

    // Record completion
    await this.db.query(
      `INSERT INTO hf_task_completions (id, assignment_id, completed_by, quality_score,
        actual_duration, skill_used, notes, xp_earned)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [completionId, data.assignment_id, data.completed_by, data.quality_score,
       data.actual_duration, data.skill_used, data.notes, xpEarned]
    );

    // Record XP transaction
    await this.db.query(
      `INSERT INTO hf_xp_transactions (household_id, member_id, action_type, action_id,
        xp_amount, formula_used, formula_inputs)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [assignment.household_id, data.completed_by, 'chore_completion', completionId,
       xpEarned, 'chore_xp_v1', JSON.stringify({
         base: assignment.xp_base_reward, difficulty: assignment.difficulty,
         quality: data.quality_score
       })]
    );

    // Emit events for XP minting and loop ledger
    await this.eventBus.publish(EventType.TASK_COMPLETED, {
      source: 'homeflow',
      action: 'chore.completed',
      householdId: assignment.household_id,
      assignmentId: data.assignment_id,
      completionId,
      xpEarned,
      deltaS: xpEarned * 0.01
    });

    return { completionId, xpEarned };
  }

  async getAssignments(householdId: string, status?: string): Promise<TaskAssignment[]> {
    let query = `SELECT ta.*, ht.name as task_name, ht.category, ht.difficulty
      FROM hf_task_assignments ta
      JOIN hf_tasks ht ON ta.task_id = ht.id
      WHERE ht.household_id = $1`;
    const params: unknown[] = [householdId];
    if (status) {
      query += ' AND ta.status = $2';
      params.push(status);
    }
    query += ' ORDER BY ta.created_at DESC';
    const result = await this.db.query(query, params);
    return result.rows;
  }

  /**
   * Chore XP Formula (from standalone homeflow_service.py):
   * Chore_XP = base_entropy x difficulty x skill_bonus x quality x efficiency x consistency x family_impact
   */
  private calculateChoreXP(params: {
    baseEntropy: number; difficulty: number; quality: number;
    estimatedTime: number; actualTime: number;
    consistencyScore: number; familyImpact: number;
  }): number {
    const skillBonus = 1.0; // TODO: calculate from member skill profile
    const efficiency = Math.min(params.estimatedTime / Math.max(params.actualTime, 1), 1.5);
    const xp = params.baseEntropy * params.difficulty * skillBonus *
               params.quality * efficiency * params.consistencyScore * params.familyImpact;
    return Math.round(xp * 100) / 100;
  }
}
