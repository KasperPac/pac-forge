-- Add block_xml column to fb_template_blocks for storing raw SimaticML XML
-- Used for library FBs imported from TIA Portal (LAD/FBD blocks that have no SCL source)
ALTER TABLE fb_template_blocks
  ADD COLUMN IF NOT EXISTS block_xml text,
  ADD COLUMN IF NOT EXISTS programming_language text DEFAULT 'SCL';

COMMENT ON COLUMN fb_template_blocks.block_xml IS 'Raw SimaticML XML exported from TIA Portal (for LAD/FBD blocks)';
COMMENT ON COLUMN fb_template_blocks.programming_language IS 'Block programming language: SCL, LAD, FBD, STL, GRAPH';
