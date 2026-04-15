-- Add HMI panel family and model to design profiles
-- Comfort is the only supported family until TIA Portal V20 is available
ALTER TABLE design_profiles
  ADD COLUMN IF NOT EXISTS hmi_panel_family text NOT NULL DEFAULT 'comfort',
  ADD COLUMN IF NOT EXISTS hmi_panel_model text NOT NULL DEFAULT 'TP1500';
