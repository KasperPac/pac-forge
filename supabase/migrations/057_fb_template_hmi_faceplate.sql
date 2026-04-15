-- Store the HMI faceplate type name on FB templates.
-- For Open Library FBs, this is the udtHMI_* companion block name
-- (e.g. "udtHMI_MotorControl" for fbMotor_DOL).
-- For custom FBs, users can set this manually.
ALTER TABLE fb_templates
  ADD COLUMN IF NOT EXISTS hmi_faceplate_type text DEFAULT NULL;
