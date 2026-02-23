-- Allow users to delete their own patterns
create policy "Users can delete own patterns"
  on public.pattern_candidates for delete using (auth.uid() = created_by);

-- Allow admins to delete any pattern
create policy "Admins can delete any pattern"
  on public.pattern_candidates for delete using (
    exists (select 1 from public.profiles where user_id = auth.uid() and role = 'ADMIN')
  );
