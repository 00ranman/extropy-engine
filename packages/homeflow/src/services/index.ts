/**
 * HomeFlow Services — Barrel Export
 *
 * Re-exports all HomeFlow service classes and interfaces
 * for clean imports throughout the monorepo.
 */
export { DatabaseService } from './database.service.js';
export { EventBusService } from './event-bus.service.js';
export { EntropyService } from './entropy.service.js';
export { HouseholdService } from './household.service.js';
export { DeviceService } from './device.service.js';
export { ClaimService } from './claim.service.js';
export { InventoryService } from './inventory.service.js';
export type { InventoryItem, InventoryFilter } from './inventory.service.js';
export { ChoreService } from './chore.service.js';
export type { HouseholdTask, TaskAssignment, TaskCompletion } from './chore.service.js';
export { MealService } from './meal.service.js';
export type { MealPlan, MealPrepSession } from './meal.service.js';
export { HealthService } from './health.service.js';
export type { HealthProfile, HealthActivity } from './health.service.js';
export { ShoppingListService } from './shopping-list.service.js';
export type { ShoppingList, ShoppingItem } from './shopping-list.service.js';
export { AnalyticsService } from './analytics.service.js';
export type { DashboardData } from './analytics.service.js';
