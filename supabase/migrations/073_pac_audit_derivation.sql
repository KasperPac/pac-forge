-- ============================================================
-- 073_pac_audit_derivation.sql
-- Pac-Audit: derived-spec layer — FB classifications, IO-FB trace
-- cache, reference-doc ingest, and expanded hardware detail
-- (per-channel IO + IO-Link hierarchy).
--
-- See Docs/PAC_AUDIT_DERIVED_SPEC.md §3, §4, §6, §9, §12.
-- ============================================================


-- ============================================================
-- audit_projects — derived-spec columns + stale-detection
-- timestamps. See §3.1.
-- ============================================================
ALTER TABLE audit_projects
  ADD COLUMN IF NOT EXISTS derived_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS derived_spec_version int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spec_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tia_project_modified_at timestamptz,
  ADD COLUMN IF NOT EXISTS cross_refs_extracted_at timestamptz;


-- ============================================================
-- audit_cross_references — reshape to match the Openness bridge
-- DTO (one row per Source → Reference → Location triple).
--
-- Reshape rationale:
--   • target_block_id must allow NULL — V3 findings (§12.0) show
--     many references target tags / absolute addresses, not blocks.
--   • The previous `reference_type` CHECK covered only 8 snake_case
--     values; the Openness `Access` enum has ~38 values and
--     `ReferenceType` has ~13 distinct relationship labels.
--     Drop the CHECK; widen freely.
--   • Add `access` column (kind of memory access) separate from
--     `reference_type` (relationship direction). §12.0.
--   • Mirror source / target / location DTO fields as columns so
--     trace queries can index them directly instead of jsonb
--     expression indexes.
--
-- Table was schema-only pre-073 (never populated in prod) — safe
-- to widen in place.
-- ============================================================
ALTER TABLE audit_cross_references
  DROP CONSTRAINT IF EXISTS audit_cross_references_reference_type_check;

ALTER TABLE audit_cross_references
  ALTER COLUMN target_block_id DROP NOT NULL;

ALTER TABLE audit_cross_references
  ADD COLUMN IF NOT EXISTS access text,
  ADD COLUMN IF NOT EXISTS source_name text,
  ADD COLUMN IF NOT EXISTS source_path text,
  ADD COLUMN IF NOT EXISTS source_address text,
  ADD COLUMN IF NOT EXISTS source_type_name text,
  ADD COLUMN IF NOT EXISTS source_device text,
  ADD COLUMN IF NOT EXISTS target_name text,
  ADD COLUMN IF NOT EXISTS target_path text,
  ADD COLUMN IF NOT EXISTS target_address text,
  ADD COLUMN IF NOT EXISTS target_type_name text,
  ADD COLUMN IF NOT EXISTS target_device text,
  ADD COLUMN IF NOT EXISTS reference_location text,
  ADD COLUMN IF NOT EXISTS referenced_as_name text,
  ADD COLUMN IF NOT EXISTS location_address text,
  ADD COLUMN IF NOT EXISTS location_name text,
  ADD COLUMN IF NOT EXISTS location_type_name text;

COMMENT ON COLUMN audit_cross_references.access IS
  'Openness Access enum (Read/Write/RW/Call/InstanceDB/Multiinstance/Interface/Definition/Jump/...). Kind of memory access at this location.';
COMMENT ON COLUMN audit_cross_references.reference_type IS
  'Openness ReferenceType enum (Uses/UsedBy/TypeInstance/InstanceType/Assigns/Defines/DefinedBy/...). Relationship direction.';

-- New indexes for trace-query patterns (§3.2)
CREATE INDEX IF NOT EXISTS idx_audit_xref_access
  ON audit_cross_references(audit_project_id, access);

CREATE INDEX IF NOT EXISTS idx_audit_xref_location_name
  ON audit_cross_references(audit_project_id, location_name);

CREATE INDEX IF NOT EXISTS idx_audit_xref_location_address
  ON audit_cross_references(audit_project_id, location_address);

CREATE INDEX IF NOT EXISTS idx_audit_xref_target_name
  ON audit_cross_references(audit_project_id, target_name);

-- Fast call-graph / instance walk: filter by Access in ('Call','InstanceDB','Multiinstance')
CREATE INDEX IF NOT EXISTS idx_audit_xref_calls
  ON audit_cross_references(audit_project_id, source_block_id, access)
  WHERE access IN ('Call', 'InstanceDB', 'Multiinstance');


-- ============================================================
-- audit_fb_classifications — per-FB role in machine hierarchy.
-- See §3.3 + §5.
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_fb_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES audit_blocks(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN (
    'device_fb', 'assembly_fb', 'subsystem_fb', 'sequence_fb',
    'utility_fb', 'safety_fb', 'comms_fb', 'ob', 'unknown'
  )),
  auto_confidence numeric CHECK (auto_confidence BETWEEN 0 AND 1),
  auto_reason text,
  engineer_confirmed boolean NOT NULL DEFAULT false,
  engineer_override_role text CHECK (engineer_override_role IS NULL OR engineer_override_role IN (
    'device_fb', 'assembly_fb', 'subsystem_fb', 'sequence_fb',
    'utility_fb', 'safety_fb', 'comms_fb', 'ob', 'unknown'
  )),
  hierarchy_assignment jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (block_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_fb_class_project
  ON audit_fb_classifications(audit_project_id);
CREATE INDEX IF NOT EXISTS idx_audit_fb_class_role
  ON audit_fb_classifications(audit_project_id, role);

ALTER TABLE audit_fb_classifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_fb_classifications_all_own" ON audit_fb_classifications
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));

CREATE TRIGGER audit_fb_classifications_updated_at
  BEFORE UPDATE ON audit_fb_classifications
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);


-- ============================================================
-- audit_io_fb_links — materialised IO-to-device-FB walk cache.
-- One row per physical IO address. Populated by the Trace RPC
-- (lands in step 12). Engineer confirmations / overrides also
-- live here. See §3.3 + §6.
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_io_fb_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,

  io_address text NOT NULL,
  io_module_ref text,
  symbolic_tag text,
  direction text NOT NULL CHECK (direction IN ('input', 'output')),

  device_fb_block_id uuid REFERENCES audit_blocks(id) ON DELETE SET NULL,
  device_fb_instance_path text,
  walk_path jsonb,
  walk_status text NOT NULL CHECK (walk_status IN (
    'resolved', 'multiple_writers', 'indirect', 'unclassified', 'unresolved'
  )),
  walk_notes text,

  physical_device_guess text,
  physical_device_source text CHECK (physical_device_source IS NULL OR physical_device_source IN (
    'hw_config', 'doc_ingest', 'engineer'
  )),

  engineer_verified boolean NOT NULL DEFAULT false,
  engineer_override_device_fb_block_id uuid REFERENCES audit_blocks(id) ON DELETE SET NULL,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (audit_project_id, io_address)
);

CREATE INDEX IF NOT EXISTS idx_audit_iofb_project
  ON audit_io_fb_links(audit_project_id);
CREATE INDEX IF NOT EXISTS idx_audit_iofb_device_fb
  ON audit_io_fb_links(device_fb_block_id);
CREATE INDEX IF NOT EXISTS idx_audit_iofb_status
  ON audit_io_fb_links(audit_project_id, walk_status);

ALTER TABLE audit_io_fb_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_io_fb_links_all_own" ON audit_io_fb_links
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));

CREATE TRIGGER audit_io_fb_links_updated_at
  BEFORE UPDATE ON audit_io_fb_links
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);


-- ============================================================
-- audit_reference_docs — uploaded prior docs (old FDS, IO list,
-- P&ID, commissioning notes, etc.). Used as priors during Verify.
-- See §3.3 + §9.
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_reference_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN (
    'fds', 'io_list', 'p_and_id', 'electrical_schematic',
    'commissioning_notes', 'hmi_export', 'other'
  )),
  filename text NOT NULL,
  storage_path text,
  raw_text text,
  parsed_priors jsonb NOT NULL DEFAULT '{}'::jsonb,
  parse_status text NOT NULL DEFAULT 'pending'
    CHECK (parse_status IN ('pending', 'parsed', 'failed')),
  parse_error text,
  uploaded_at timestamptz DEFAULT now(),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_refdocs_project
  ON audit_reference_docs(audit_project_id);
CREATE INDEX IF NOT EXISTS idx_audit_refdocs_type
  ON audit_reference_docs(audit_project_id, doc_type);

ALTER TABLE audit_reference_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_reference_docs_all_own" ON audit_reference_docs
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));


-- ============================================================
-- audit_module_channels — per-channel IO detail unrolled from IO
-- module StartAddress. Queryable for Trace joins by io_address or
-- symbolic_tag. See §12.6.
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_module_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  module_name text NOT NULL,
  module_mlfb text,
  channel_number int NOT NULL,
  io_address text,
  signal_type text CHECK (signal_type IS NULL OR signal_type IN (
    'DI', 'DO', 'AI', 'AO', 'DIQ', 'RS485', 'other'
  )),
  symbolic_tag text,
  is_safety boolean NOT NULL DEFAULT false,
  channel_comment text,
  channel_count_source text CHECK (channel_count_source IS NULL OR channel_count_source IN (
    'length_in_bits', 'length_bytes', 'name_pattern', 'single_row'
  )),
  rack int,
  slot int,
  created_at timestamptz DEFAULT now(),
  UNIQUE (audit_project_id, module_name, channel_number)
);

CREATE INDEX IF NOT EXISTS idx_audit_mod_ch_project
  ON audit_module_channels(audit_project_id);
CREATE INDEX IF NOT EXISTS idx_audit_mod_ch_address
  ON audit_module_channels(audit_project_id, io_address);
CREATE INDEX IF NOT EXISTS idx_audit_mod_ch_tag
  ON audit_module_channels(audit_project_id, symbolic_tag);
CREATE INDEX IF NOT EXISTS idx_audit_mod_ch_module
  ON audit_module_channels(audit_project_id, module_name);

ALTER TABLE audit_module_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_module_channels_all_own" ON audit_module_channels
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));


-- ============================================================
-- audit_io_link_devices — IO-Link master → port → attached device
-- hierarchy. Parent-child structure doesn't fit cleanly in the
-- hardware_config.devices[] jsonb. See §12.6.
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_io_link_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  master_module_name text NOT NULL,
  port_number int NOT NULL,
  vendor_id text NOT NULL,
  product_id text NOT NULL,
  product_name text,
  iodd_sha text,
  process_data_in jsonb,
  process_data_out jsonb,
  parameters jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE (audit_project_id, master_module_name, port_number)
);

CREATE INDEX IF NOT EXISTS idx_audit_iolink_project
  ON audit_io_link_devices(audit_project_id);
CREATE INDEX IF NOT EXISTS idx_audit_iolink_master
  ON audit_io_link_devices(audit_project_id, master_module_name);

ALTER TABLE audit_io_link_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_io_link_devices_all_own" ON audit_io_link_devices
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));
