/**
 * HomeFlow Family Pilot, file-backed data layer for v1 features.
 *
 * Persists households, members, chores, recipes, meal plans, pantry items,
 * shopping list, and chore completions to the same JSON file used by
 * FileBackedDb (see file-db.service.ts), under a top-level `family` key so
 * the pilot data lives alongside users / pslls / genesis without colliding.
 *
 * Atomic writes: serialize to .tmp, fsync, rename. All mutations go through
 * the persist() chain so concurrent requests don't race.
 */

import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

export type Role = 'parent' | 'teen' | 'kid';
export type ChoreFrequency = 'once' | 'daily' | 'weekly' | 'custom';
export type AssigneeKind = string | 'anyone' | 'rotation';
export type PantryLocation = 'fridge' | 'pantry' | 'freezer' | 'other';
export type ShoppingSource = 'pantry' | 'meal-plan' | 'manual';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner';

export interface Household {
  id: string;
  name: string;
  timezone: string;
  ownerUserId: string;
  address?: string | null;
  zip?: string | null;
  createdAt: number;
  archivedAt?: number | null;
}

export interface Member {
  id: string;
  householdId: string;
  userId?: string | null;
  name: string;
  role: Role;
  avatar: string;
  xpVisible: boolean;
  xpTotal: number;
  createdAt: number;
}

export interface Chore {
  id: string;
  householdId: string;
  name: string;
  description?: string | null;
  frequency: ChoreFrequency;
  customCron?: string | null;
  assignee: AssigneeKind;
  xpReward: number;
  category?: string | null;
  rotationIndex?: number;
  createdAt: number;
}

export interface ChoreCompletion {
  id: string;
  choreId: string;
  memberId: string;
  completedAt: number;
  xpAwarded: number;
}

export interface RecipeIngredient {
  name: string;
  qty: number;
  unit: string;
}

export interface Recipe {
  id: string;
  householdId: string;
  title: string;
  ingredients: RecipeIngredient[];
  steps: string;
  prepMinutes: number;
  cookMinutes: number;
  tags: string[];
  createdAt: number;
}

export type MealEntry = { recipeId: string } | { freeText: string } | null;

export interface MealPlanWeek {
  weekStart: string;
  slots: Record<string, Partial<Record<MealSlot, MealEntry>>>;
}

export interface PantryItem {
  id: string;
  householdId: string;
  name: string;
  qty: number;
  unit: string;
  location: PantryLocation;
  lowStockThreshold: number;
  updatedAt: number;
}

export interface ShoppingItem {
  id: string;
  householdId: string;
  name: string;
  qty?: number | null;
  unit?: string | null;
  source: ShoppingSource;
  sourceRefId?: string | null;
  checked: boolean;
  createdAt: number;
}

export interface FamilyData {
  households: Record<string, Household>;
  members: Record<string, Member>;
  chores: Record<string, Chore>;
  choreCompletions: Record<string, ChoreCompletion>;
  recipes: Record<string, Recipe>;
  mealPlan: Record<string, MealPlanWeek>;
  pantry: Record<string, PantryItem>;
  shoppingList: Record<string, ShoppingItem>;
}

const EMPTY_FAMILY = (): FamilyData => ({
  households: {},
  members: {},
  chores: {},
  choreCompletions: {},
  recipes: {},
  mealPlan: {},
  pantry: {},
  shoppingList: {},
});

interface RawSnapshot {
  users?: unknown[];
  pslls?: unknown[];
  genesis?: unknown[];
  family?: Partial<FamilyData>;
}

export interface FamilyStoreOptions {
  dataDir: string;
  fileName?: string;
}

export class FamilyStore {
  private readonly filePath: string;
  private snapshot: RawSnapshot = {};
  private family: FamilyData = EMPTY_FAMILY();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(opts: FamilyStoreOptions) {
    fs.mkdirSync(opts.dataDir, { recursive: true });
    this.filePath = path.join(opts.dataDir, opts.fileName ?? 'homeflow.json');
  }

  get path(): string {
    return this.filePath;
  }

  private load(): void {
    if (this.loaded) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as RawSnapshot;
      this.snapshot = parsed;
      const f = parsed.family ?? {};
      this.family = {
        households: { ...EMPTY_FAMILY().households, ...(f.households ?? {}) },
        members: { ...EMPTY_FAMILY().members, ...(f.members ?? {}) },
        chores: { ...EMPTY_FAMILY().chores, ...(f.chores ?? {}) },
        choreCompletions: { ...EMPTY_FAMILY().choreCompletions, ...(f.choreCompletions ?? {}) },
        recipes: { ...EMPTY_FAMILY().recipes, ...(f.recipes ?? {}) },
        mealPlan: { ...EMPTY_FAMILY().mealPlan, ...(f.mealPlan ?? {}) },
        pantry: { ...EMPTY_FAMILY().pantry, ...(f.pantry ?? {}) },
        shoppingList: { ...EMPTY_FAMILY().shoppingList, ...(f.shoppingList ?? {}) },
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.snapshot = {};
        this.family = EMPTY_FAMILY();
      } else {
        throw err;
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const next = this.writeChain.then(async () => {
      this.load();
      let current: RawSnapshot = {};
      try {
        const raw = await fs.promises.readFile(this.filePath, 'utf-8');
        current = JSON.parse(raw) as RawSnapshot;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      const merged: RawSnapshot = {
        ...current,
        family: this.family,
      };
      this.snapshot = merged;
      const tmp = `${this.filePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
      const data = JSON.stringify(merged, null, 2);
      const fh = await fs.promises.open(tmp, 'w');
      try {
        await fh.writeFile(data, 'utf-8');
        await fh.sync();
      } finally {
        await fh.close();
      }
      await fs.promises.rename(tmp, this.filePath);
    });
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  async initialize(): Promise<void> {
    this.load();
  }

  // ── Households ────────────────────────────────────────────────────────────

  async createHousehold(input: {
    name: string;
    timezone?: string;
    ownerUserId: string;
    address?: string | null;
    zip?: string | null;
  }): Promise<Household> {
    this.load();
    const id = uuidv4();
    const h: Household = {
      id,
      name: input.name,
      timezone: input.timezone ?? 'America/Chicago',
      ownerUserId: input.ownerUserId,
      address: input.address ?? null,
      zip: input.zip ?? null,
      createdAt: Date.now(),
      archivedAt: null,
    };
    this.family.households[id] = h;
    await this.persist();
    return h;
  }

  async updateHousehold(id: string, patch: Partial<Pick<Household, 'name' | 'timezone' | 'address' | 'zip'>>): Promise<Household | null> {
    this.load();
    const h = this.family.households[id];
    if (!h) return null;
    Object.assign(h, patch);
    await this.persist();
    return h;
  }

  async archiveHousehold(id: string): Promise<boolean> {
    this.load();
    const h = this.family.households[id];
    if (!h) return false;
    h.archivedAt = Date.now();
    await this.persist();
    return true;
  }

  getHousehold(id: string): Household | null {
    this.load();
    return this.family.households[id] ?? null;
  }

  getHouseholdByOwner(userId: string): Household | null {
    this.load();
    for (const h of Object.values(this.family.households)) {
      if (h.ownerUserId === userId && !h.archivedAt) return h;
    }
    return null;
  }

  getHouseholdByMemberUserId(userId: string): Household | null {
    this.load();
    for (const m of Object.values(this.family.members)) {
      if (m.userId === userId) {
        const h = this.family.households[m.householdId];
        if (h && !h.archivedAt) return h;
      }
    }
    return null;
  }

  resolveHouseholdForUser(userId: string): Household | null {
    return this.getHouseholdByOwner(userId) ?? this.getHouseholdByMemberUserId(userId);
  }

  // ── Members ───────────────────────────────────────────────────────────────

  async addMember(input: {
    householdId: string;
    userId?: string | null;
    name: string;
    role: Role;
    avatar?: string;
    xpVisible?: boolean;
  }): Promise<Member> {
    this.load();
    const id = uuidv4();
    const m: Member = {
      id,
      householdId: input.householdId,
      userId: input.userId ?? null,
      name: input.name,
      role: input.role,
      avatar: input.avatar ?? input.name.slice(0, 1).toUpperCase(),
      xpVisible: input.xpVisible ?? true,
      xpTotal: 0,
      createdAt: Date.now(),
    };
    this.family.members[id] = m;
    await this.persist();
    return m;
  }

  async updateMember(id: string, patch: Partial<Pick<Member, 'name' | 'role' | 'avatar' | 'xpVisible'>>): Promise<Member | null> {
    this.load();
    const m = this.family.members[id];
    if (!m) return null;
    Object.assign(m, patch);
    await this.persist();
    return m;
  }

  async removeMember(id: string): Promise<boolean> {
    this.load();
    if (!this.family.members[id]) return false;
    delete this.family.members[id];
    await this.persist();
    return true;
  }

  listMembers(householdId: string): Member[] {
    this.load();
    return Object.values(this.family.members)
      .filter(m => m.householdId === householdId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  getMember(id: string): Member | null {
    this.load();
    return this.family.members[id] ?? null;
  }

  // ── Chores ────────────────────────────────────────────────────────────────

  async createChore(input: Omit<Chore, 'id' | 'createdAt'>): Promise<Chore> {
    this.load();
    const id = uuidv4();
    const c: Chore = { id, createdAt: Date.now(), ...input };
    this.family.chores[id] = c;
    await this.persist();
    return c;
  }

  async updateChore(id: string, patch: Partial<Omit<Chore, 'id' | 'householdId' | 'createdAt'>>): Promise<Chore | null> {
    this.load();
    const c = this.family.chores[id];
    if (!c) return null;
    Object.assign(c, patch);
    await this.persist();
    return c;
  }

  async deleteChore(id: string): Promise<boolean> {
    this.load();
    if (!this.family.chores[id]) return false;
    delete this.family.chores[id];
    await this.persist();
    return true;
  }

  listChores(householdId: string): Chore[] {
    this.load();
    return Object.values(this.family.chores)
      .filter(c => c.householdId === householdId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  getChore(id: string): Chore | null {
    this.load();
    return this.family.chores[id] ?? null;
  }

  async completeChore(input: { choreId: string; memberId: string }): Promise<ChoreCompletion> {
    this.load();
    const chore = this.family.chores[input.choreId];
    if (!chore) throw new Error('chore_not_found');
    const member = this.family.members[input.memberId];
    if (!member) throw new Error('member_not_found');

    const id = uuidv4();
    const completion: ChoreCompletion = {
      id,
      choreId: chore.id,
      memberId: member.id,
      completedAt: Date.now(),
      xpAwarded: chore.xpReward,
    };
    this.family.choreCompletions[id] = completion;
    member.xpTotal = (member.xpTotal ?? 0) + chore.xpReward;

    if (chore.assignee === 'rotation') {
      const members = this.listMembers(chore.householdId);
      if (members.length > 0) {
        chore.rotationIndex = ((chore.rotationIndex ?? 0) + 1) % members.length;
      }
    }
    await this.persist();
    return completion;
  }

  listCompletions(choreId: string, limit = 30): ChoreCompletion[] {
    this.load();
    return Object.values(this.family.choreCompletions)
      .filter(c => c.choreId === choreId)
      .sort((a, b) => b.completedAt - a.completedAt)
      .slice(0, limit);
  }

  listRecentCompletions(householdId: string, limit = 5): ChoreCompletion[] {
    this.load();
    const choreIds = new Set(
      Object.values(this.family.chores)
        .filter(c => c.householdId === householdId)
        .map(c => c.id),
    );
    return Object.values(this.family.choreCompletions)
      .filter(c => choreIds.has(c.choreId))
      .sort((a, b) => b.completedAt - a.completedAt)
      .slice(0, limit);
  }

  // ── Recipes ───────────────────────────────────────────────────────────────

  async createRecipe(input: Omit<Recipe, 'id' | 'createdAt'>): Promise<Recipe> {
    this.load();
    const id = uuidv4();
    const r: Recipe = { id, createdAt: Date.now(), ...input };
    this.family.recipes[id] = r;
    await this.persist();
    return r;
  }

  async updateRecipe(id: string, patch: Partial<Omit<Recipe, 'id' | 'householdId' | 'createdAt'>>): Promise<Recipe | null> {
    this.load();
    const r = this.family.recipes[id];
    if (!r) return null;
    Object.assign(r, patch);
    await this.persist();
    return r;
  }

  async deleteRecipe(id: string): Promise<boolean> {
    this.load();
    if (!this.family.recipes[id]) return false;
    delete this.family.recipes[id];
    await this.persist();
    return true;
  }

  listRecipes(householdId: string): Recipe[] {
    this.load();
    return Object.values(this.family.recipes)
      .filter(r => r.householdId === householdId)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  getRecipe(id: string): Recipe | null {
    this.load();
    return this.family.recipes[id] ?? null;
  }

  // ── Meal plan ─────────────────────────────────────────────────────────────

  getMealPlan(householdId: string): MealPlanWeek {
    this.load();
    return (
      this.family.mealPlan[householdId] ?? {
        weekStart: weekStartIso(new Date()),
        slots: {},
      }
    );
  }

  async setMealSlot(householdId: string, date: string, slot: MealSlot, entry: MealEntry): Promise<MealPlanWeek> {
    this.load();
    const plan = this.family.mealPlan[householdId] ?? {
      weekStart: weekStartIso(new Date()),
      slots: {},
    };
    plan.weekStart = weekStartIso(new Date(date + 'T00:00:00Z'));
    if (!plan.slots[date]) plan.slots[date] = {};
    if (entry === null) {
      delete plan.slots[date][slot];
    } else {
      plan.slots[date][slot] = entry;
    }
    this.family.mealPlan[householdId] = plan;
    await this.persist();
    return plan;
  }

  async setMealPlanWeekStart(householdId: string, weekStart: string): Promise<MealPlanWeek> {
    this.load();
    const plan = this.family.mealPlan[householdId] ?? { weekStart, slots: {} };
    plan.weekStart = weekStart;
    this.family.mealPlan[householdId] = plan;
    await this.persist();
    return plan;
  }

  // ── Pantry ────────────────────────────────────────────────────────────────

  async createPantryItem(input: Omit<PantryItem, 'id' | 'updatedAt'>): Promise<PantryItem> {
    this.load();
    const id = uuidv4();
    const item: PantryItem = { id, updatedAt: Date.now(), ...input };
    this.family.pantry[id] = item;
    await this.persist();
    return item;
  }

  async updatePantryItem(id: string, patch: Partial<Omit<PantryItem, 'id' | 'householdId'>>): Promise<PantryItem | null> {
    this.load();
    const item = this.family.pantry[id];
    if (!item) return null;
    Object.assign(item, patch);
    item.updatedAt = Date.now();
    await this.persist();
    return item;
  }

  async deletePantryItem(id: string): Promise<boolean> {
    this.load();
    if (!this.family.pantry[id]) return false;
    delete this.family.pantry[id];
    await this.persist();
    return true;
  }

  listPantry(householdId: string): PantryItem[] {
    this.load();
    return Object.values(this.family.pantry)
      .filter(p => p.householdId === householdId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── Shopping list ─────────────────────────────────────────────────────────

  async addShoppingItem(input: Omit<ShoppingItem, 'id' | 'createdAt' | 'checked'> & { checked?: boolean }): Promise<ShoppingItem> {
    this.load();
    const id = uuidv4();
    const item: ShoppingItem = {
      id,
      createdAt: Date.now(),
      checked: input.checked ?? false,
      ...input,
    };
    this.family.shoppingList[id] = item;
    await this.persist();
    return item;
  }

  async updateShoppingItem(id: string, patch: Partial<Omit<ShoppingItem, 'id' | 'householdId' | 'createdAt'>>): Promise<ShoppingItem | null> {
    this.load();
    const item = this.family.shoppingList[id];
    if (!item) return null;
    Object.assign(item, patch);
    await this.persist();
    return item;
  }

  async deleteShoppingItem(id: string): Promise<boolean> {
    this.load();
    if (!this.family.shoppingList[id]) return false;
    delete this.family.shoppingList[id];
    await this.persist();
    return true;
  }

  listShopping(householdId: string): ShoppingItem[] {
    this.load();
    return Object.values(this.family.shoppingList)
      .filter(s => s.householdId === householdId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  getShoppingItem(id: string): ShoppingItem | null {
    this.load();
    return this.family.shoppingList[id] ?? null;
  }

  // ── Bulk derived helpers ──────────────────────────────────────────────────

  syncPantryDerivedShopping(householdId: string): void {
    this.load();
    const items = this.listPantry(householdId);
    const existingByRef = new Map(
      this.listShopping(householdId)
        .filter(s => s.source === 'pantry' && s.sourceRefId)
        .map(s => [s.sourceRefId as string, s] as const),
    );
    for (const item of items) {
      const low = item.qty <= item.lowStockThreshold;
      const existing = existingByRef.get(item.id);
      if (low && !existing) {
        const id = uuidv4();
        this.family.shoppingList[id] = {
          id,
          householdId,
          name: item.name,
          qty: null,
          unit: item.unit,
          source: 'pantry',
          sourceRefId: item.id,
          checked: false,
          createdAt: Date.now(),
        };
      } else if (!low && existing && !existing.checked) {
        delete this.family.shoppingList[existing.id];
      }
    }
  }

  /** Returns the snapshot path used by the file-backed db, for tests. */
  static defaultFileName(): string {
    return 'homeflow.json';
  }
}

export function weekStartIso(d: Date): string {
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  return mon.toISOString().slice(0, 10);
}
