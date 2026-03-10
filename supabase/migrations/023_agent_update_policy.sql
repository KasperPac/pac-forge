-- Allow authenticated users to update agent rows (enable/disable toggle)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agents' AND policyname = 'Authenticated users can update agents'
  ) THEN
    CREATE POLICY "Authenticated users can update agents"
      ON agents FOR UPDATE
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
