-- Add CPU targeting columns to migration_sessions
-- Stores detected source PLC info and user-chosen S7-1500 target

ALTER TABLE migration_sessions
  ADD COLUMN IF NOT EXISTS source_plc_family      TEXT,          -- e.g. "SIMATIC 300"
  ADD COLUMN IF NOT EXISTS source_cpu_type_id     TEXT,          -- e.g. "OrderNumber:6ES7 317-2EK14-0AB0/V3.3"
  ADD COLUMN IF NOT EXISTS target_cpu_order_number TEXT,         -- e.g. "6ES7 516-3AN02-0AB0/V2.9"
  ADD COLUMN IF NOT EXISTS target_project_path    TEXT;          -- full path to the new S7-1500 project file
