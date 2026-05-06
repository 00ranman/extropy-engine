/**
 * HomeFlow Family Pilot v1 API.
 *
 * All routes are auth-gated (requireSession) and scope by the household
 * resolved from the signed-in user (owner, or member with userId set).
 *
 * Surface:
 *   GET    /api/family/bootstrap           current user + their household + members (or null)
 *   POST   /api/family/setup               create household + initial members + optional seed
 *
 *   GET    /api/family/household           current household
 *   PATCH  /api/family/household           update name/timezone/address/zip
 *   POST   /api/family/household/archive   soft delete
 *
 *   GET    /api/family/members
 *   POST   /api/family/members
 *   PATCH  /api/family/members/:id
 *   DELETE /api/family/members/:id
 *
 *   GET    /api/family/chores
 *   POST   /api/family/chores
 *   PATCH  /api/family/chores/:id
 *   DELETE /api/family/chores/:id
 *   POST   /api/family/chores/:id/complete  body: { memberId }
 *   GET    /api/family/chores/:id/history
 *
 *   GET    /api/family/recipes
 *   POST   /api/family/recipes
 *   PATCH  /api/family/recipes/:id
 *   DELETE /api/family/recipes/:id
 *
 *   GET    /api/family/meal-plan
 *   PUT    /api/family/meal-plan/slot       body: { date, slot, entry }
 *   POST   /api/family/meal-plan/generate-shopping-list
 *
 *   GET    /api/family/pantry
 *   POST   /api/family/pantry
 *   PATCH  /api/family/pantry/:id
 *   DELETE /api/family/pantry/:id
 *
 *   GET    /api/family/shopping
 *   POST   /api/family/shopping
 *   PATCH  /api/family/shopping/:id
 *   DELETE /api/family/shopping/:id
 *
 *   GET    /api/family/dashboard
 */

import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { UserService } from '../services/user.service.js';
import type { FamilyStore, MealSlot, Role, ChoreFrequency, AssigneeKind, PantryLocation, ShoppingSource } from '../services/family-store.service.js';
import { requireSession, type AuthedRequest } from '../auth/auth.middleware.js';
import { applySeed } from '../services/family-seed.js';

function resolveHousehold(store: FamilyStore, userId: string) {
  return store.resolveHouseholdForUser(userId);
}

function requireHousehold(store: FamilyStore) {
  return function (req: AuthedRequest, res: Response, next: NextFunction): void {
    const userId = req.hfUser?.id;
    if (!userId) {
      res.status(401).json({ error: 'not_authenticated' });
      return;
    }
    const household = resolveHousehold(store, userId);
    if (!household) {
      res.status(404).json({ error: 'no_household' });
      return;
    }
    (req as AuthedRequest & { householdId?: string }).householdId = household.id;
    next();
  };
}

const SetupSchema = z.object({
  household: z.object({
    name: z.string().min(1).max(100),
    timezone: z.string().optional(),
    address: z.string().nullish(),
    zip: z.string().nullish(),
  }),
  members: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        role: z.enum(['parent', 'teen', 'kid']),
        avatar: z.string().max(8).optional(),
      }),
    )
    .default([]),
  ownerName: z.string().min(1).max(60).optional(),
  seed: z
    .object({
      chores: z.boolean().default(true),
      recipes: z.boolean().default(true),
      pantry: z.boolean().default(true),
    })
    .default({ chores: true, recipes: true, pantry: true }),
});

const HouseholdPatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().optional(),
  address: z.string().nullish(),
  zip: z.string().nullish(),
});

const MemberSchema = z.object({
  name: z.string().min(1).max(60),
  role: z.enum(['parent', 'teen', 'kid']),
  avatar: z.string().max(8).optional(),
  xpVisible: z.boolean().optional(),
});

const MemberPatchSchema = MemberSchema.partial();

const ChoreSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().nullish(),
  frequency: z.enum(['once', 'daily', 'weekly', 'custom']),
  customCron: z.string().nullish(),
  assignee: z.string().min(1),
  xpReward: z.number().int().min(0).max(1000),
  category: z.string().nullish(),
});

const ChorePatchSchema = ChoreSchema.partial();

const RecipeSchema = z.object({
  title: z.string().min(1).max(200),
  ingredients: z.array(z.object({
    name: z.string().min(1),
    qty: z.number().nonnegative(),
    unit: z.string(),
  })).default([]),
  steps: z.string().default(''),
  prepMinutes: z.number().int().min(0).default(0),
  cookMinutes: z.number().int().min(0).default(0),
  tags: z.array(z.string()).default([]),
});

const RecipePatchSchema = RecipeSchema.partial();

const PantrySchema = z.object({
  name: z.string().min(1).max(120),
  qty: z.number().nonnegative(),
  unit: z.string().min(1).max(20),
  location: z.enum(['fridge', 'pantry', 'freezer', 'other']),
  lowStockThreshold: z.number().nonnegative().default(1),
});

const PantryPatchSchema = PantrySchema.partial();

const ShoppingSchema = z.object({
  name: z.string().min(1).max(120),
  qty: z.number().nullish(),
  unit: z.string().nullish(),
  source: z.enum(['pantry', 'meal-plan', 'manual']).default('manual'),
  sourceRefId: z.string().nullish(),
});

const ShoppingPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  qty: z.number().nullish(),
  unit: z.string().nullish(),
  checked: z.boolean().optional(),
});

const MealSlotSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(['breakfast', 'lunch', 'dinner']),
  entry: z.union([
    z.object({ recipeId: z.string() }),
    z.object({ freeText: z.string() }),
    z.null(),
  ]),
});

export function createFamilyRoutes(userService: UserService, store: FamilyStore): Router {
  const router = Router();
  const auth = requireSession(userService);

  // ── Bootstrap ───────────────────────────────────────────────────────────
  router.get('/bootstrap', auth, (req: AuthedRequest, res: Response) => {
    const user = req.hfUser!;
    const household = resolveHousehold(store, user.id);
    if (!household) {
      res.json({ user: serializeUser(user), household: null, members: [], isOwner: false });
      return;
    }
    const members = store.listMembers(household.id);
    res.json({
      user: serializeUser(user),
      household,
      members,
      isOwner: household.ownerUserId === user.id,
    });
  });

  // ── Setup wizard ────────────────────────────────────────────────────────
  router.post('/setup', auth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.hfUser!;
      if (resolveHousehold(store, user.id)) {
        res.status(409).json({ error: 'household_exists' });
        return;
      }
      const parsed = SetupSchema.parse(req.body);
      const household = await store.createHousehold({
        name: parsed.household.name,
        timezone: parsed.household.timezone ?? 'America/Chicago',
        ownerUserId: user.id,
        address: parsed.household.address ?? null,
        zip: parsed.household.zip ?? null,
      });
      // Owner auto-added as parent
      const ownerName = parsed.ownerName ?? user.displayName ?? user.email ?? 'Owner';
      await store.addMember({
        householdId: household.id,
        userId: user.id,
        name: ownerName,
        role: 'parent',
      });
      for (const m of parsed.members) {
        await store.addMember({
          householdId: household.id,
          name: m.name,
          role: m.role,
          ...(m.avatar !== undefined ? { avatar: m.avatar } : {}),
        });
      }
      await applySeed(store, household.id, parsed.seed);
      const members = store.listMembers(household.id);
      res.status(201).json({ household, members });
    } catch (err) {
      next(err);
    }
  });

  // ── Household ───────────────────────────────────────────────────────────
  const hh = requireHousehold(store);

  router.get('/household', auth, hh, (req: AuthedRequest, res: Response) => {
    const id = (req as AuthedRequest & { householdId: string }).householdId;
    res.json(store.getHousehold(id));
  });

  router.patch('/household', auth, hh, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const id = (req as AuthedRequest & { householdId: string }).householdId;
      const patch = HouseholdPatchSchema.parse(req.body);
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) cleaned[k] = v;
      const updated = await store.updateHousehold(id, cleaned);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.post('/household/archive', auth, hh, async (req: AuthedRequest, res: Response) => {
    const id = (req as AuthedRequest & { householdId: string }).householdId;
    const ok = await store.archiveHousehold(id);
    res.json({ ok });
  });

  // ── Members ─────────────────────────────────────────────────────────────
  router.get('/members', auth, hh, (req: AuthedRequest, res: Response) => {
    const id = (req as AuthedRequest & { householdId: string }).householdId;
    res.json(store.listMembers(id));
  });

  router.post('/members', auth, hh, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const id = (req as AuthedRequest & { householdId: string }).householdId;
      const parsed = MemberSchema.parse(req.body);
      const created = await store.addMember({
        householdId: id,
        name: parsed.name,
        role: parsed.role as Role,
        ...(parsed.avatar !== undefined ? { avatar: parsed.avatar } : {}),
        ...(parsed.xpVisible !== undefined ? { xpVisible: parsed.xpVisible } : {}),
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/members/:id', auth, hh, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const householdId = (req as AuthedRequest & { householdId: string }).householdId;
      const member = store.getMember(req.params.id);
      if (!member || member.householdId !== householdId) {
        res.status(404).json({ error: 'member_not_found' });
        return;
      }
      const patch = MemberPatchSchema.parse(req.body);
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) cleaned[k] = v;
      const updated = await store.updateMember(req.params.id, cleaned);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/members/:id', auth, hh, async (req: AuthedRequest, res: Response) => {
    const householdId = (req as AuthedRequest & { householdId: string }).householdId;
    const member = store.getMember(req.params.id);
    if (!member || member.householdId !== householdId) {
      res.status(404).json({ error: 'member_not_found' });
      return;
    }
    await store.removeMember(req.params.id);
    res.json({ ok: true });
  });

  // ── Chores ──────────────────────────────────────────────────────────────
  router.get('/chores', auth, hh, (req: AuthedRequest, res: Response) => {
    const id = (req as AuthedRequest & { householdId: string }).householdId;
    res.json(store.listChores(id));
  });

  router.post('/chores', auth, hh, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const id = (req as AuthedRequest & { householdId: string }).householdId;
      const parsed = ChoreSchema.parse(req.body);
      const created = await store.createChore({
        householdId: id,
        name: parsed.name,
        description: parsed.description ?? null,
        frequency: parsed.frequency as ChoreFrequency,
        customCron: parsed.customCron ?? null,
        assignee: parsed.assignee as AssigneeKind,
        xpReward: parsed.xpReward,
        category: parsed.category ?? null,
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/chores/:id', auth, hh, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const householdId = (req as AuthedRequest & { householdId: string }).householdId;
      const c = store.getChore(req.params.id);
      if (!c || c.householdId !== householdId) {
        res.status(404).json({ error: 'chore_not_found' });
        return;
      }
      const patch = ChorePatchSchema.parse(req.body);
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) cleaned[k] = v;
      const updated = await store.updateChore(req.params.id, cleaned);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/chores/:id', auth, hh, async (req: AuthedRequest, res: Response) => {
    const householdId = (req as AuthedRequest & { householdId: string }).householdId;
    const c = store.getChore(req.params.id);
    if (!c || c.householdId !== householdId) {
      res.status(404).json({ error: 'chore_not_found' });
      return;
    }
    await store.deleteChore(req.params.id);
    res.json({ ok: true });
  });

  router.post('/chores/:id/complete', auth, hh, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const householdId = (req as AuthedRequest & { householdId: string }).householdId;
      const chore = store.getChore(req.params.id);
      if (!chore || chore.householdId !== householdId) {
        res.status(404).json({ error: 'chore_not_found' });
        return;
      }
      const body = z.object({ memberId: z.string() }).parse(req.body);
      const member = store.getMember(body.memberId);
      if (!member || member.householdId !== householdId) {
        res.status(400).json({ error: 'invalid_member' });
        return;
      }
      const completion = await store.completeChore({ choreId: chore.id, memberId: member.id });
      const refreshedMember = store.getMember(member.id);
      res.status(201).json({ completion, member: refreshedMember });
    } catch (err) {
      next(err);
    }
  });

  router.get('/chores/:id/history', auth, hh, (req: AuthedRequest, res: Response) => {
    const householdId = (req as AuthedRequest & { householdId: string }).householdId;
    const chore = store.getChore(req.params.id);
    if (!chore || chore.householdId !== householdId) {
      res.status(404).json({ error: 'chore_not_found' });
      return;
    }
    res.json(store.listCompletions(chore.id, 30));
  });

  // ── Recipes ─────────────────────────────────────────────────────────────
  router.get('/recipes', auth, hh, (req: AuthedRequest, res: Response) => {
    const id = (req as AuthedRequest & { householdId: string }).householdId;
    res.json(store.listRecipes(id));
  });

  router.post('/recipes', auth, hh, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const id = (req as AuthedRequest & { householdId: string }).householdId;
      const parsed = RecipeSchema.parse(req.body);
      const created = await store.createRecipe({ householdId: id, ...parsed });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/recipes/:id', auth, hh, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const householdId = (req as AuthedRequest & { householdId: string }).householdId;
      const r = store.getRecipe(req.params.id);
      if (!r || r.householdId !== householdId) {
        res.status(404).json({ error: 'recipe_not_found' });
        return;
      }
      const patch = RecipePatchSchema.parse(req.body);
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) cleaned[k] = v;
      const updated = await store.updateRecipe(req.params.id, cleaned);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/recipes/:id', auth, hh, async (req: AuthedRequest, res: Response) => {
    const householdId = (req as AuthedRequest & { householdId: string }).householdId;
    const r = store.getRecipe(req.params.id);
    if (!r || r.householdId !== householdId) {
      res.status(404).json({ error: 'recipe_not_found' });
      return;
    }
    await store.deleteRecipe(req.params.id);
    res.json({ ok: true });
  });

  // ── Meal plan ───────────────────────────────────────────────────────────
  router.get('/meal-plan', auth, hh, (req: AuthedRequest, res: Response) => {
    const id = (req as AuthedRequest & { householdId: string }).householdId;
    res.json(store.getMealPlan(id));
  });

  router.put('/meal-plan/slot', auth, hh, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const id = (req as AuthedRequest & { householdId: string }).householdId;
      const parsed = MealSlotSchema.parse(req.body);
      const plan = await store.setMealSlot(id, parsed.date, parsed.slot as MealSlot, parsed.entry);
      res.json(plan);
    } catch (err) {
      next(err);
    }
  });

  router.post('/meal-plan/generate-shopping-list', auth, hh, async (req: AuthedRequest, res: Response) => {
    const id = (req as AuthedRequest & { householdId: string }).householdId;
    const plan = store.getMealPlan(id);
    const recipes = store.listRecipes(id);
    const recipeById = new Map(recipes.map(r => [r.id, r] as const));
    const pantry = store.listPantry(id).reduce<Map<string, number>>((acc, p) => {
      acc.set(p.name.toLowerCase(), p.qty);
      return acc;
    }, new Map());
    const needed = new Map<string, { name: string; qty: number; unit: string }>();
    for (const slots of Object.values(plan.slots)) {
      for (const entry of Object.values(slots)) {
        if (!entry || !('recipeId' in entry)) continue;
        const r = recipeById.get(entry.recipeId);
        if (!r) continue;
        for (const ing of r.ingredients) {
          const key = `${ing.name.toLowerCase()}|${ing.unit.toLowerCase()}`;
          const existing = needed.get(key);
          if (existing) existing.qty += ing.qty;
          else needed.set(key, { name: ing.name, qty: ing.qty, unit: ing.unit });
        }
      }
    }
    const added: string[] = [];
    for (const need of needed.values()) {
      const have = pantry.get(need.name.toLowerCase()) ?? 0;
      const remaining = need.qty - have;
      if (remaining <= 0) continue;
      const created = await store.addShoppingItem({
        householdId: id,
        name: need.name,
        qty: remaining,
        unit: need.unit,
        source: 'meal-plan' as ShoppingSource,
        sourceRefId: null,
      });
      added.push(created.id);
    }
    res.json({ added: added.length, items: store.listShopping(id) });
  });

  // ── Pantry ──────────────────────────────────────────────────────────────
  router.get('/pantry', auth, hh, (req: AuthedRequest, res: Response) => {
    const id = (req as AuthedRequest & { householdId: string }).householdId;
    res.json(store.listPantry(id));
  });

  router.post('/pantry', auth, hh, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const id = (req as AuthedRequest & { householdId: string }).householdId;
      const parsed = PantrySchema.parse(req.body);
      const created = await store.createPantryItem({
        householdId: id,
        name: parsed.name,
        qty: parsed.qty,
        unit: parsed.unit,
        location: parsed.location as PantryLocation,
        lowStockThreshold: parsed.lowStockThreshold,
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/pantry/:id', auth, hh, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const householdId = (req as AuthedRequest & { householdId: string }).householdId;
      const p = store.listPantry(householdId).find(it => it.id === req.params.id);
      if (!p) {
        res.status(404).json({ error: 'pantry_not_found' });
        return;
      }
      const patch = PantryPatchSchema.parse(req.body);
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) cleaned[k] = v;
      const updated = await store.updatePantryItem(req.params.id, cleaned);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/pantry/:id', auth, hh, async (req: AuthedRequest, res: Response) => {
    const householdId = (req as AuthedRequest & { householdId: string }).householdId;
    const p = store.listPantry(householdId).find(it => it.id === req.params.id);
    if (!p) {
      res.status(404).json({ error: 'pantry_not_found' });
      return;
    }
    await store.deletePantryItem(req.params.id);
    res.json({ ok: true });
  });

  // ── Shopping list ───────────────────────────────────────────────────────
  router.get('/shopping', auth, hh, (req: AuthedRequest, res: Response) => {
    const id = (req as AuthedRequest & { householdId: string }).householdId;
    store.syncPantryDerivedShopping(id);
    res.json(store.listShopping(id));
  });

  router.post('/shopping', auth, hh, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const id = (req as AuthedRequest & { householdId: string }).householdId;
      const parsed = ShoppingSchema.parse(req.body);
      const created = await store.addShoppingItem({
        householdId: id,
        name: parsed.name,
        qty: parsed.qty ?? null,
        unit: parsed.unit ?? null,
        source: parsed.source as ShoppingSource,
        sourceRefId: parsed.sourceRefId ?? null,
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/shopping/:id', auth, hh, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const householdId = (req as AuthedRequest & { householdId: string }).householdId;
      const item = store.getShoppingItem(req.params.id);
      if (!item || item.householdId !== householdId) {
        res.status(404).json({ error: 'shopping_not_found' });
        return;
      }
      const patch = ShoppingPatchSchema.parse(req.body);
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) cleaned[k] = v;
      const updated = await store.updateShoppingItem(req.params.id, cleaned);
      // If a pantry-sourced item is checked off and a new qty is supplied,
      // mirror that into the pantry record.
      if (
        updated &&
        updated.checked &&
        updated.source === 'pantry' &&
        updated.sourceRefId &&
        typeof patch.qty === 'number'
      ) {
        await store.updatePantryItem(updated.sourceRefId, { qty: patch.qty });
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/shopping/:id', auth, hh, async (req: AuthedRequest, res: Response) => {
    const householdId = (req as AuthedRequest & { householdId: string }).householdId;
    const item = store.getShoppingItem(req.params.id);
    if (!item || item.householdId !== householdId) {
      res.status(404).json({ error: 'shopping_not_found' });
      return;
    }
    await store.deleteShoppingItem(req.params.id);
    res.json({ ok: true });
  });

  // ── Dashboard ───────────────────────────────────────────────────────────
  router.get('/dashboard', auth, hh, (req: AuthedRequest, res: Response) => {
    const id = (req as AuthedRequest & { householdId: string }).householdId;
    const members = store.listMembers(id);
    const chores = store.listChores(id);
    const memberById = new Map(members.map(m => [m.id, m] as const));
    const choreById = new Map(chores.map(c => [c.id, c] as const));
    const today = new Date().toISOString().slice(0, 10);
    const plan = store.getMealPlan(id);
    const todayMeals = plan.slots[today] ?? {};
    const pantry = store.listPantry(id);
    const lowStock = pantry.filter(p => p.qty <= p.lowStockThreshold);
    const recent = store.listRecentCompletions(id, 5).map(c => {
      const chore = choreById.get(c.choreId);
      const member = memberById.get(c.memberId);
      return {
        id: c.id,
        choreId: c.choreId,
        choreName: chore?.name ?? 'Unknown',
        memberId: c.memberId,
        memberName: member?.name ?? 'Unknown',
        xpAwarded: c.xpAwarded,
        completedAt: c.completedAt,
      };
    });
    const todayChoresPerMember = members.map(m => ({
      member: m,
      chores: chores.filter(c => c.assignee === m.id || c.assignee === 'anyone' || c.assignee === 'rotation'),
    }));
    res.json({
      today,
      todayChoresPerMember,
      tonight: todayMeals.dinner ?? null,
      meals: todayMeals,
      lowStockCount: lowStock.length,
      lowStock,
      recentCompletions: recent,
      memberXp: members.map(m => ({ id: m.id, name: m.name, xpTotal: m.xpTotal, xpVisible: m.xpVisible })),
    });
  });

  return router;
}

function serializeUser(u: { id: string; email: string; displayName: string; avatarUrl: string | null; did: string | null }): Record<string, unknown> {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    did: u.did,
    onboarded: !!u.did,
  };
}
