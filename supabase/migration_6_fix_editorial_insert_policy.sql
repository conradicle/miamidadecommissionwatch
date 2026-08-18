-- Miami-Dade Commission Watch: close editorial moderation bypass
-- Run this once in the Supabase SQL editor, after migration_5.
--
-- The original insert policy on editorial_submissions was `with check (true)`,
-- which only checked that a row could be inserted at all -- it placed no
-- constraint on the values of that row. Since the anon key is public by
-- design, anyone could bypass submit-editorial.html entirely and POST
-- directly to the REST API with status: 'approved' (plus a spoofed
-- reviewed_at/reviewed_by), publishing arbitrary content straight to the
-- public editorials feed with no staff review.
--
-- Fix: require new submissions to land in the unreviewed state. Only staff
-- (via the existing "Staff can update submissions" policy) can move a row
-- to approved/rejected after that.

drop policy if exists "Anyone can submit an editorial" on public.editorial_submissions;
create policy "Anyone can submit an editorial"
  on public.editorial_submissions for insert
  with check (status = 'pending' and reviewed_at is null and reviewed_by is null);
