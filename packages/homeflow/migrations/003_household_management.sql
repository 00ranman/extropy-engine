-- Migration 003: Household Management Tables
-- Bridges standalone HomeFlow features into the Extropy Engine ecosystem
-- Ref: https://github.com/00ranman/extropy-engine/issues/5

CREATE TABLE IF NOT EXISTS hf_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES hf_households(id),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'General',
  subcategory VARCHAR(100),
  quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit VARCHAR(50) NOT NULL DEFAULT 'units',
  location VARCHAR(255),
  expiration_date TIMESTAMPTZ,
  reorder_level NUMERIC(10,2) NOT NULL DEFAULT 2,
  brand VARCHAR(255),
  cost NUMERIC(10,2),
  barcode VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hf_inventory_household ON hf_inventory(household_id);
CREATE INDEX idx_hf_inventory_category ON hf_inventory(category);

CREATE TABLE IF NOT EXISTS hf_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES hf_households(id),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  description TEXT,
  difficulty NUMERIC(3,1) NOT NULL DEFAULT 1.0,
  skill_requirements TEXT[],
  time_estimate INTEGER,
  frequency_days INTEGER,
  xp_base_reward NUMERIC(10,2) DEFAULT 10.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hf_task_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES hf_tasks(id),
  assigned_to VARCHAR(255) NOT NULL,
  assigned_by VARCHAR(255),
  due_date TIMESTAMPTZ,
  priority VARCHAR(20) DEFAULT 'normal',
  status VARCHAR(20) DEFAULT 'pending',
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hf_task_completions (
  id SERIAL PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES hf_task_assignments(id),
  completed_by VARCHAR(255) NOT NULL,
  quality_score NUMERIC(3,2) DEFAULT 0.8,
  xp_earned NUMERIC(10,2),
  xp_transaction_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hf_meal_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES hf_households(id),
  name VARCHAR(255) NOT NULL,
  meal_type VARCHAR(50),
  planned_date DATE,
  nutrition_score NUMERIC(3,2),
  ingredients JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hf_health_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES hf_households(id),
  user_id VARCHAR(255) NOT NULL,
  age INTEGER,
  activity_level VARCHAR(50),
  dietary_restrictions TEXT[],
  health_goals TEXT[],
  allergies TEXT[],
  nutrition_targets JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hf_xp_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES hf_households(id),
  user_id VARCHAR(255) NOT NULL,
  action_type VARCHAR(50) NOT NULL,
  description TEXT,
  entropy_delta NUMERIC(10,4),
  xp_value NUMERIC(10,2),
  loop_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hf_xp_user ON hf_xp_transactions(user_id);
