-- ============================================================
-- 047: Instruction & Function Library
-- Structured reference for LAD/SCL instructions with pin definitions.
-- Replaces hardcoded instruction metadata in the LAD engine.
-- Fully idempotent — safe to re-run after partial apply.
-- ============================================================

-- 1. Instructions table (one row per instruction type)
CREATE TABLE IF NOT EXISTS instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  element_type text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN (
    'bit_logic', 'timers_counters', 'comparators', 'math', 'move_convert', 'extended'
  )),
  description text,
  simatic_part_name text NOT NULL,
  programming_language text NOT NULL DEFAULT 'BOTH' CHECK (programming_language IN ('LAD', 'SCL', 'BOTH')),
  supported_platforms text[] NOT NULL DEFAULT '{S7-1200,S7-1500}',
  is_box boolean NOT NULL DEFAULT false,
  is_output boolean NOT NULL DEFAULT false,
  has_instance boolean NOT NULL DEFAULT false,
  has_operator boolean NOT NULL DEFAULT false,
  operators text[],
  operator_part_names jsonb,
  notes text,
  verified boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE instructions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'instructions_select') THEN
    CREATE POLICY "instructions_select" ON instructions FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'instructions_insert') THEN
    CREATE POLICY "instructions_insert" ON instructions FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'instructions_update') THEN
    CREATE POLICY "instructions_update" ON instructions FOR UPDATE TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'instructions_delete') THEN
    CREATE POLICY "instructions_delete" ON instructions FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_instructions_category ON instructions(category);

-- 2. Instruction pins table (one row per pin per instruction)
CREATE TABLE IF NOT EXISTS instruction_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instruction_id uuid NOT NULL REFERENCES instructions(id) ON DELETE CASCADE,
  pin_name text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out', 'inout')),
  data_type text NOT NULL DEFAULT 'BOOL',
  is_rung_flow boolean NOT NULL DEFAULT false,
  is_required boolean NOT NULL DEFAULT true,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE instruction_pins ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'instruction_pins_select') THEN
    CREATE POLICY "instruction_pins_select" ON instruction_pins FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'instruction_pins_insert') THEN
    CREATE POLICY "instruction_pins_insert" ON instruction_pins FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'instruction_pins_update') THEN
    CREATE POLICY "instruction_pins_update" ON instruction_pins FOR UPDATE TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'instruction_pins_delete') THEN
    CREATE POLICY "instruction_pins_delete" ON instruction_pins FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_instruction_pins_instruction ON instruction_pins(instruction_id);

-- ============================================================
-- 3. Seed data: all currently supported LAD instructions
-- ============================================================

-- Helper: insert instruction and return its id for pin inserts
-- We use a DO block with variables to avoid repeating UUIDs

DO $$
DECLARE
  v_id uuid;
BEGIN

  -- ---- BIT LOGIC ----

  -- NO_CONTACT
  INSERT INTO instructions (name, element_type, category, description, simatic_part_name, programming_language, is_box, is_output, sort_order)
  VALUES ('NO Contact', 'NO_CONTACT', 'bit_logic', 'Normally open contact --| |--. Closed (passes power) when operand is TRUE.', 'Contact', 'LAD', false, false, 1)
  ON CONFLICT (element_type) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO instruction_pins (instruction_id, pin_name, direction, data_type, is_rung_flow, description, sort_order) VALUES
      (v_id, 'in',      'in',  'BOOL', true,  'Rung power flow input',  1),
      (v_id, 'out',     'out', 'BOOL', true,  'Rung power flow output', 2),
      (v_id, 'operand', 'in',  'BOOL', false, 'Tag to check (TRUE = contact closed)', 3);
  END IF;

  -- NC_CONTACT
  INSERT INTO instructions (name, element_type, category, description, simatic_part_name, programming_language, is_box, is_output, sort_order)
  VALUES ('NC Contact', 'NC_CONTACT', 'bit_logic', 'Normally closed contact --|/|--. Closed (passes power) when operand is FALSE.', 'Contact', 'LAD', false, false, 2)
  ON CONFLICT (element_type) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO instruction_pins (instruction_id, pin_name, direction, data_type, is_rung_flow, description, sort_order) VALUES
      (v_id, 'in',      'in',  'BOOL', true,  'Rung power flow input',  1),
      (v_id, 'out',     'out', 'BOOL', true,  'Rung power flow output', 2),
      (v_id, 'operand', 'in',  'BOOL', false, 'Tag to check (FALSE = contact closed)', 3);
  END IF;

  -- OUTPUT_COIL
  INSERT INTO instructions (name, element_type, category, description, simatic_part_name, programming_language, is_box, is_output, sort_order)
  VALUES ('Output Coil', 'OUTPUT_COIL', 'bit_logic', 'Standard output coil --( )--. Operand set to rung result each scan.', 'Coil', 'LAD', false, true, 3)
  ON CONFLICT (element_type) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO instruction_pins (instruction_id, pin_name, direction, data_type, is_rung_flow, description, sort_order) VALUES
      (v_id, 'in',      'in',  'BOOL', true,  'Rung power flow input',  1),
      (v_id, 'out',     'out', 'BOOL', true,  'Rung power flow output', 2),
      (v_id, 'operand', 'out', 'BOOL', false, 'Tag to write (set to rung state)', 3);
  END IF;

  -- SET_COIL
  INSERT INTO instructions (name, element_type, category, description, simatic_part_name, programming_language, is_box, is_output, sort_order)
  VALUES ('Set Coil', 'SET_COIL', 'bit_logic', 'Set (latch) coil --(S)--. Sets operand to TRUE when rung is TRUE; does not reset.', 'SCoil', 'LAD', false, true, 4)
  ON CONFLICT (element_type) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO instruction_pins (instruction_id, pin_name, direction, data_type, is_rung_flow, description, sort_order) VALUES
      (v_id, 'in',      'in',  'BOOL', true,  'Rung power flow input',  1),
      (v_id, 'out',     'out', 'BOOL', true,  'Rung power flow output', 2),
      (v_id, 'operand', 'out', 'BOOL', false, 'Tag to set (latched TRUE)', 3);
  END IF;

  -- RESET_COIL
  INSERT INTO instructions (name, element_type, category, description, simatic_part_name, programming_language, is_box, is_output, sort_order)
  VALUES ('Reset Coil', 'RESET_COIL', 'bit_logic', 'Reset (unlatch) coil --(R)--. Resets operand to FALSE when rung is TRUE.', 'RCoil', 'LAD', false, true, 5)
  ON CONFLICT (element_type) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO instruction_pins (instruction_id, pin_name, direction, data_type, is_rung_flow, description, sort_order) VALUES
      (v_id, 'in',      'in',  'BOOL', true,  'Rung power flow input',  1),
      (v_id, 'out',     'out', 'BOOL', true,  'Rung power flow output', 2),
      (v_id, 'operand', 'out', 'BOOL', false, 'Tag to reset (cleared FALSE)', 3);
  END IF;

  -- ---- TIMERS & COUNTERS ----

  -- TON
  INSERT INTO instructions (name, element_type, category, description, simatic_part_name, programming_language, is_box, is_output, has_instance, sort_order)
  VALUES ('TON Timer', 'TON', 'timers_counters', 'IEC Timer ON delay. Starts timing when IN goes TRUE; Q goes TRUE after PT elapses. Requires static instance variable.', 'TON', 'BOTH', true, true, true, 10)
  ON CONFLICT (element_type) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO instruction_pins (instruction_id, pin_name, direction, data_type, is_rung_flow, description, sort_order) VALUES
      (v_id, 'IN', 'in',  'BOOL', true,  'Timer start input (rung flow)', 1),
      (v_id, 'PT', 'in',  'TIME', false, 'Preset time (e.g. T#5s)',       2),
      (v_id, 'Q',  'out', 'BOOL', true,  'Timer done output (rung flow)', 3),
      (v_id, 'ET', 'out', 'TIME', false, 'Elapsed time',                  4);
  END IF;

  -- TOF
  INSERT INTO instructions (name, element_type, category, description, simatic_part_name, programming_language, is_box, is_output, has_instance, sort_order)
  VALUES ('TOF Timer', 'TOF', 'timers_counters', 'IEC Timer OFF delay. Q goes TRUE immediately when IN is TRUE; stays TRUE for PT after IN goes FALSE. Requires static instance variable.', 'TOF', 'BOTH', true, true, true, 11)
  ON CONFLICT (element_type) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO instruction_pins (instruction_id, pin_name, direction, data_type, is_rung_flow, description, sort_order) VALUES
      (v_id, 'IN', 'in',  'BOOL', true,  'Timer start input (rung flow)', 1),
      (v_id, 'PT', 'in',  'TIME', false, 'Preset time (e.g. T#5s)',       2),
      (v_id, 'Q',  'out', 'BOOL', true,  'Timer output (rung flow)',      3),
      (v_id, 'ET', 'out', 'TIME', false, 'Elapsed time',                  4);
  END IF;

  -- CTU
  INSERT INTO instructions (name, element_type, category, description, simatic_part_name, programming_language, is_box, is_output, has_instance, sort_order)
  VALUES ('CTU Counter', 'CTU', 'timers_counters', 'IEC Count Up. Increments on rising edge of CU. Q = TRUE when CV >= PV. Requires static instance variable.', 'CTU', 'BOTH', true, true, true, 12)
  ON CONFLICT (element_type) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO instruction_pins (instruction_id, pin_name, direction, data_type, is_rung_flow, description, sort_order) VALUES
      (v_id, 'CU', 'in',  'BOOL', true,  'Count up input (rising edge)', 1),
      (v_id, 'PV', 'in',  'INT',  false, 'Preset value',                 2),
      (v_id, 'Q',  'out', 'BOOL', true,  'Counter done (CV >= PV)',      3),
      (v_id, 'CV', 'out', 'INT',  false, 'Current count value',          4);
  END IF;

  -- CTD
  INSERT INTO instructions (name, element_type, category, description, simatic_part_name, programming_language, is_box, is_output, has_instance, sort_order)
  VALUES ('CTD Counter', 'CTD', 'timers_counters', 'IEC Count Down. Decrements on rising edge of CD. Q = TRUE when CV <= 0. Requires static instance variable.', 'CTD', 'BOTH', true, true, true, 13)
  ON CONFLICT (element_type) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO instruction_pins (instruction_id, pin_name, direction, data_type, is_rung_flow, description, sort_order) VALUES
      (v_id, 'CD', 'in',  'BOOL', true,  'Count down input (rising edge)', 1),
      (v_id, 'PV', 'in',  'INT',  false, 'Preset value',                   2),
      (v_id, 'Q',  'out', 'BOOL', true,  'Counter done (CV <= 0)',         3),
      (v_id, 'CV', 'out', 'INT',  false, 'Current count value',            4);
  END IF;

  -- ---- COMPARATORS ----

  -- CMP
  INSERT INTO instructions (name, element_type, category, description, simatic_part_name, programming_language, is_box, is_output, has_operator, operators, operator_part_names, sort_order)
  VALUES (
    'Compare', 'CMP', 'comparators',
    'Comparison box. Compares in1 and in2 using the selected operator. Output (out) is TRUE if comparison holds. Acts like a contact in rung flow — can be followed by more logic.',
    'Cmp', 'LAD', true, false, true,
    '{==,!=,>,<,>=,<=}',
    '{"==":"Eq","!=":"Ne",">":"Gt","<":"Lt",">=":"Ge","<=":"Le"}',
    20
  )
  ON CONFLICT (element_type) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO instruction_pins (instruction_id, pin_name, direction, data_type, is_rung_flow, description, sort_order) VALUES
      (v_id, 'pre', 'in',  'BOOL', true,  'Rung flow input (NOT "in")', 1),
      (v_id, 'out', 'out', 'BOOL', true,  'Rung flow output (TRUE if comparison holds)', 2),
      (v_id, 'in1', 'in',  'ANY',  false, 'First comparison operand',   3),
      (v_id, 'in2', 'in',  'ANY',  false, 'Second comparison operand',  4);
  END IF;

  -- ---- MATH ----

  -- MATH
  INSERT INTO instructions (name, element_type, category, description, simatic_part_name, programming_language, is_box, is_output, has_operator, operators, operator_part_names, sort_order)
  VALUES (
    'Math', 'MATH', 'math',
    'Arithmetic operation box. Performs the selected operation: out = in1 OP in2. Self-contained — must be the final element in the rung.',
    'Math', 'LAD', true, true, true,
    '{ADD,SUB,MUL,DIV}',
    '{"ADD":"Add","SUB":"Sub","MUL":"Mul","DIV":"Div"}',
    30
  )
  ON CONFLICT (element_type) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO instruction_pins (instruction_id, pin_name, direction, data_type, is_rung_flow, description, sort_order) VALUES
      (v_id, 'en',  'in',  'BOOL', true,  'Enable input (rung flow)',  1),
      (v_id, 'eno', 'out', 'BOOL', true,  'Enable output (rung flow)', 2),
      (v_id, 'in1', 'in',  'ANY',  false, 'First operand',             3),
      (v_id, 'in2', 'in',  'ANY',  false, 'Second operand',            4),
      (v_id, 'out', 'out', 'ANY',  false, 'Result operand',            5);
  END IF;

  -- ---- MOVE / CONVERT ----

  -- MOVE
  INSERT INTO instructions (name, element_type, category, description, simatic_part_name, programming_language, is_box, is_output, sort_order)
  VALUES ('Move', 'MOVE', 'move_convert', 'Move value box. Copies input value to output. Self-contained — must be the final element in the rung.', 'Move', 'LAD', true, true, 40)
  ON CONFLICT (element_type) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO instruction_pins (instruction_id, pin_name, direction, data_type, is_rung_flow, description, sort_order) VALUES
      (v_id, 'en',   'in',  'BOOL', true,  'Enable input (rung flow)',  1),
      (v_id, 'eno',  'out', 'BOOL', true,  'Enable output (rung flow)', 2),
      (v_id, 'in',   'in',  'ANY',  false, 'Source value',              3),
      (v_id, 'out1', 'out', 'ANY',  false, 'Destination value',         4);
  END IF;

  -- ---- FB CALL (special) ----

  -- FB_CALL
  INSERT INTO instructions (name, element_type, category, description, simatic_part_name, programming_language, is_box, is_output, has_instance, sort_order, notes)
  VALUES (
    'FB Call', 'FB_CALL', 'extended',
    'Function Block call box. Calls an FB with its instance DB. Pins are dynamic — defined by the FB interface. Uses en/eno for rung flow.',
    'Call', 'LAD', true, true, true, 50,
    'Pin names are dynamic based on the called FB interface. The fbName and fbInstanceDb fields on LadElement specify which FB and instance DB to use. callParams array defines the parameter wiring.'
  )
  ON CONFLICT (element_type) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO instruction_pins (instruction_id, pin_name, direction, data_type, is_rung_flow, description, sort_order) VALUES
      (v_id, 'en',  'in',  'BOOL', true, 'Enable input (rung flow)',  1),
      (v_id, 'eno', 'out', 'BOOL', true, 'Enable output (rung flow)', 2);
  END IF;

END $$;
