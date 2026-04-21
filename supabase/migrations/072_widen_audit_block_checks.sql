-- TIA Portal Openness returns block_type and programming_language values that
-- vary by version and block category (safety FBs, motion DBs, system blocks, etc).
-- The strict CHECK constraints introduced in 070 are over-constraining.
-- Replace with open text columns — validation happens at the application layer.

ALTER TABLE audit_blocks
  DROP CONSTRAINT IF EXISTS audit_blocks_block_type_check,
  DROP CONSTRAINT IF EXISTS audit_blocks_programming_language_check;
