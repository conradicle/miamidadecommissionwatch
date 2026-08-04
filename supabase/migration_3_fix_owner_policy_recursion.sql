-- Fixes "infinite recursion detected in policy for relation user_roles",
-- caused by the owner-read/update policies in migration_2 querying
-- user_roles from within a policy defined on user_roles itself. Even
-- reading your own row failed, because Postgres evaluates every policy on
-- the table, not just whichever one would trivially pass.
--
-- Fix: move the check into a security-definer function. Functions created
-- via the SQL editor run as the 'postgres' role, which has BYPASSRLS, so
-- the function's internal query skips RLS entirely instead of recursing.

create or replace function public.is_active_owner()
returns boolean
language sql
security definer
set search_path = public
stable
as 'select exists (select 1 from public.user_roles where user_id = auth.uid() and role = ''owner'' and status = ''active'')';

drop policy if exists "Owners can read all roles" on public.user_roles;
create policy "Owners can read all roles"
  on public.user_roles for select
  using (public.is_active_owner());

drop policy if exists "Owners can update roles" on public.user_roles;
create policy "Owners can update roles"
  on public.user_roles for update
  using (public.is_active_owner());
