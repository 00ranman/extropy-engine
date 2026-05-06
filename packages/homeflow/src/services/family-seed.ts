/**
 * Sample seed data applied during the setup wizard when the operator opts
 * into quick-start. Realistic enough to be useful, generic enough to fit any
 * household.
 */

import type { FamilyStore } from './family-store.service.js';

export interface SeedFlags {
  chores: boolean;
  recipes: boolean;
  pantry: boolean;
}

export async function applySeed(store: FamilyStore, householdId: string, flags: SeedFlags): Promise<void> {
  if (flags.chores) await seedChores(store, householdId);
  if (flags.recipes) await seedRecipes(store, householdId);
  if (flags.pantry) await seedPantry(store, householdId);
}

async function seedChores(store: FamilyStore, householdId: string): Promise<void> {
  const items = [
    { name: 'Take out trash', frequency: 'weekly', assignee: 'anyone', xpReward: 5, category: 'cleaning' },
    { name: 'Empty dishwasher', frequency: 'daily', assignee: 'anyone', xpReward: 3, category: 'kitchen' },
    { name: 'Vacuum living room', frequency: 'weekly', assignee: 'anyone', xpReward: 8, category: 'cleaning' },
    { name: 'Feed pets', frequency: 'daily', assignee: 'anyone', xpReward: 2, category: 'pets' },
    { name: 'Make bed', frequency: 'daily', assignee: 'anyone', xpReward: 1, category: 'bedroom' },
    { name: 'Laundry', frequency: 'weekly', assignee: 'anyone', xpReward: 10, category: 'laundry' },
  ] as const;
  for (const c of items) {
    await store.createChore({
      householdId,
      name: c.name,
      description: null,
      frequency: c.frequency,
      assignee: c.assignee,
      xpReward: c.xpReward,
      category: c.category,
      customCron: null,
    });
  }
}

async function seedRecipes(store: FamilyStore, householdId: string): Promise<void> {
  const recipes = [
    {
      title: 'Pancakes',
      ingredients: [
        { name: 'flour', qty: 1.5, unit: 'cup' },
        { name: 'milk', qty: 1.25, unit: 'cup' },
        { name: 'eggs', qty: 1, unit: 'each' },
        { name: 'butter', qty: 3, unit: 'tbsp' },
        { name: 'sugar', qty: 1, unit: 'tbsp' },
        { name: 'baking powder', qty: 3.5, unit: 'tsp' },
        { name: 'salt', qty: 0.25, unit: 'tsp' },
      ],
      steps: '1. Whisk dry. 2. Add wet. 3. Cook on griddle until bubbles, flip.',
      prepMinutes: 5,
      cookMinutes: 15,
      tags: ['breakfast', 'kid-friendly'],
    },
    {
      title: 'Spaghetti and meatballs',
      ingredients: [
        { name: 'pasta', qty: 1, unit: 'lb' },
        { name: 'ground beef', qty: 1, unit: 'lb' },
        { name: 'tomato sauce', qty: 24, unit: 'oz' },
        { name: 'garlic', qty: 3, unit: 'clove' },
        { name: 'onion', qty: 1, unit: 'each' },
        { name: 'parmesan', qty: 0.5, unit: 'cup' },
      ],
      steps: '1. Brown meatballs. 2. Simmer in sauce. 3. Boil pasta. 4. Combine and top with parm.',
      prepMinutes: 15,
      cookMinutes: 30,
      tags: ['dinner', 'family'],
    },
    {
      title: 'Tacos',
      ingredients: [
        { name: 'ground beef', qty: 1, unit: 'lb' },
        { name: 'taco shells', qty: 12, unit: 'each' },
        { name: 'cheese', qty: 1, unit: 'cup' },
        { name: 'lettuce', qty: 1, unit: 'head' },
        { name: 'tomato', qty: 2, unit: 'each' },
        { name: 'salsa', qty: 1, unit: 'cup' },
      ],
      steps: '1. Brown beef with seasoning. 2. Warm shells. 3. Assemble with toppings.',
      prepMinutes: 10,
      cookMinutes: 15,
      tags: ['dinner', 'mexican'],
    },
    {
      title: 'Chicken stir-fry',
      ingredients: [
        { name: 'chicken breast', qty: 1, unit: 'lb' },
        { name: 'broccoli', qty: 2, unit: 'cup' },
        { name: 'bell pepper', qty: 1, unit: 'each' },
        { name: 'soy sauce', qty: 3, unit: 'tbsp' },
        { name: 'garlic', qty: 2, unit: 'clove' },
        { name: 'rice', qty: 1, unit: 'cup' },
      ],
      steps: '1. Cook rice. 2. Stir-fry chicken. 3. Add veg and soy. 4. Serve over rice.',
      prepMinutes: 15,
      cookMinutes: 20,
      tags: ['dinner', 'asian'],
    },
  ];
  for (const r of recipes) {
    await store.createRecipe({ householdId, ...r });
  }
}

async function seedPantry(store: FamilyStore, householdId: string): Promise<void> {
  const items = [
    { name: 'eggs', qty: 12, unit: 'each', location: 'fridge', lowStockThreshold: 4 },
    { name: 'milk', qty: 1, unit: 'gal', location: 'fridge', lowStockThreshold: 1 },
    { name: 'butter', qty: 2, unit: 'stick', location: 'fridge', lowStockThreshold: 1 },
    { name: 'flour', qty: 5, unit: 'lb', location: 'pantry', lowStockThreshold: 1 },
    { name: 'salt', qty: 1, unit: 'box', location: 'pantry', lowStockThreshold: 1 },
    { name: 'pasta', qty: 3, unit: 'box', location: 'pantry', lowStockThreshold: 1 },
    { name: 'tomato sauce', qty: 4, unit: 'jar', location: 'pantry', lowStockThreshold: 1 },
    { name: 'ground beef', qty: 2, unit: 'lb', location: 'freezer', lowStockThreshold: 1 },
  ] as const;
  for (const it of items) {
    await store.createPantryItem({ householdId, ...it });
  }
}
