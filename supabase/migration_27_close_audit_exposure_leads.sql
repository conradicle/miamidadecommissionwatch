-- Close four exposure leads from the 2026-10 security audit (written against
-- origin/main 52efc99). DRAFT: not applied anywhere. Run by hand in the
-- Supabase SQL editor, in the order below.
--
--   Lead 1  Any signed-in non-staff account can read grade, school and
--           school_email of approved editorials. schema.sql's approved-row
--           policy has no TO clause, and migration_12 narrowed columns for
--           anon only.
--   Lead 2  anon can read editorial_submissions.name (migration_12 grants
--           it). The site cuts it to "First L." in the browser, but the API
--           hands out every approved student author's full name. Every one
--           of them is a minor.
--   Lead 3  meeting_items, item_votes and item_sources are readable with
--           using (true), so a draft meeting's items, votes and sources leak
--           through top-level reads (js/home.js, js/commissioner.js).
--           migration_22 hid only the meetings row itself.
--   Lead 4  A city editor can unpublish or delete published city_officials
--           and city_meetings. guard_publish_rights() checks only NEW.status
--           and never runs on DELETE, and the members' delete policy has no
--           status condition.
--
-- None of the four was confirmed against the live database when this was
-- written. Run section 0 first. If a check shows a lead is already closed,
-- or the live schema differs from the repo, stop and reconcile before running
-- anything else.
--
-- Run order:
--   0. Before running: read-only checks. Changes nothing.
--   A. Additive / independent of client code. Safe before the deploy, and
--      REQUIRED before it: the build reads published_editorials and fails
--      loudly (PGRST205) until A has run. A failed build leaves the last good
--      deployment serving, so nothing breaks for readers; the site just stops
--      updating.
--   (deploy the branch that ships with this file: js/admin.js,
--    js/editorials-feed.js, js/city-admin.js, scripts/lib/data.mjs,
--    scripts/lib/render.mjs)
--   B. Column revokes for leads 1 and 2. Only AFTER that deploy is live:
--      the old admin.js asks for select('*') and the old news feed asks for
--      name, and both stop working once B runs. (The prerendered News page
--      keeps working either way.)


-- =========================================================================
-- 0. Before running (read-only)
-- =========================================================================
-- Paste and run these on their own. Expected results assume the leads are
-- real; anything else means the live database has drifted from the repo.

-- 0.1 Lead 1: true for any of these confirms non-staff signed-in users can
--     read the minor's details (RLS still limits them to approved rows).
-- select has_column_privilege('authenticated', 'public.editorial_submissions', 'grade',        'select') as auth_grade,
--        has_column_privilege('authenticated', 'public.editorial_submissions', 'school',       'select') as auth_school,
--        has_column_privilege('authenticated', 'public.editorial_submissions', 'school_email', 'select') as auth_school_email;
--
--     Policies on the table. Expect "Public can read approved editorials"
--     with roles {0} (= PUBLIC, i.e. no TO clause) and "Staff can read all
--     submissions".
-- select polname, polcmd, polroles::regrole[], pg_get_expr(polqual, polrelid) as using_expr
--   from pg_policy where polrelid = 'public.editorial_submissions'::regclass order by polname;
--
--     Also check by hand: Authentication > Providers > Email > "Allow new
--     users to sign up". If on, anyone can get an authenticated session.

-- 0.2 Lead 2: true confirms the full name is public.
-- select has_column_privilege('anon', 'public.editorial_submissions', 'name', 'select') as anon_name;
--
--     Every column anon and authenticated can read today:
-- select grantee, column_name from information_schema.column_privileges
--  where table_schema = 'public' and table_name = 'editorial_submissions'
--    and privilege_type = 'SELECT' and grantee in ('anon', 'authenticated')
--  order by grantee, column_name;

-- 0.3 Lead 3: a using_expr of exactly "true" on the three "Public can read"
--     policies confirms the leak. Any other policy here is out of tree
--     (there is no migration_11 in the repo) and needs a look first.
-- select polrelid::regclass as tbl, polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
--   from pg_policy
--  where polrelid in ('public.meeting_items'::regclass, 'public.item_votes'::regclass, 'public.item_sources'::regclass)
--  order by 1, 2;
--
--     How much draft content is exposed right now:
-- select count(distinct m.id) as draft_meetings,
--        count(distinct i.id) as draft_items,
--        (select count(*) from public.item_votes v join public.meeting_items i2 on i2.id = v.item_id
--           join public.meetings m2 on m2.id = i2.meeting_id where not m2.published) as draft_votes,
--        (select count(*) from public.item_sources s join public.meeting_items i3 on i3.id = s.item_id
--           join public.meetings m3 on m3.id = i3.meeting_id where not m3.published) as draft_sources
--   from public.meetings m left join public.meeting_items i on i.meeting_id = m.id
--  where not m.published;

-- 0.4 Lead 4: the live guard should match migration_20 (checks new.status
--     only), the triggers should be BEFORE INSERT OR UPDATE (no DELETE), and
--     "Members can delete their ..." should be is_city_member(city_id) alone.
-- select pg_get_functiondef('public.guard_publish_rights()'::regprocedure);
-- select tgrelid::regclass, tgname, pg_get_triggerdef(oid)
--   from pg_trigger
--  where tgrelid in ('public.city_officials'::regclass, 'public.city_meetings'::regclass) and not tgisinternal;
-- select polrelid::regclass, polname, polcmd, pg_get_expr(polqual, polrelid)
--   from pg_policy
--  where polrelid in ('public.city_officials'::regclass, 'public.city_meetings'::regclass) and polcmd in ('w', 'd')
--  order by 1, 2;

-- 0.5 Dependencies this file relies on, and names it would take. Expect the
--     first three non-null and the last five null.
-- select to_regprocedure('public.is_active_staff()')          as is_active_staff,
--        to_regprocedure('public.is_service_role()')          as is_service_role,
--        to_regprocedure('public.is_city_owner(uuid)')        as is_city_owner,
--        to_regprocedure('public.public_byline(text)')        as taken_public_byline,
--        to_regclass('public.published_editorials')           as taken_published_editorials,
--        to_regprocedure('public.staff_editorial_submissions(uuid)') as taken_staff_fn,
--        to_regprocedure('public.meeting_is_published(uuid)')      as taken_meeting_fn,
--        to_regprocedure('public.meeting_item_is_published(uuid)') as taken_item_fn;


-- =========================================================================
-- A. Additive / independent of client code (safe before the deploy)
-- =========================================================================
begin;

-- -------------------------------------------------------------------------
-- A1. Lead 2: the byline, computed in the database
-- -------------------------------------------------------------------------
-- A port of js/public-byline.js, rule for rule, so the full name never has to
-- leave Postgres for a public page. The JS copy stays: the build still uses it
-- for the team roster (assets/data/contributors.json). If either copy changes,
-- change both. Examples (same as the JS file):
--   'Stefano Sanchez'          -> 'Stefano S.'
--   'Ana Maria Gonzalez Perez' -> 'Ana Maria G.'
--   'Maria Gonzalez-Perez'     -> 'Maria G.'
--   'Ana de la Cruz'           -> 'Ana C.'
--   'Cher'                     -> 'Cher'
--   '' / null                  -> ''
create or replace function public.public_byline(p_full_name text)
returns text
language plpgsql
immutable
set search_path = public
as $fn$
declare
  particles constant text[] := array[
    'de', 'del', 'della', 'di', 'da', 'das', 'dos', 'du', 'la', 'las', 'le',
    'los', 'van', 'von', 'der', 'den', 'ter', 'al', 'bin', 'ibn', 'y', 'i',
    'san', 'st', 'mac', 'mc', 'o'
  ];
  tokens text[];
  n int;
  surname_start int := null;
  given text;
  v_initial text := null;
  i int;
begin
  tokens := array(
    select t
      from unnest(regexp_split_to_array(
             btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g')), ' '))
           with ordinality as u(t, ord)
     where t <> ''
     order by ord
  );
  n := coalesce(array_length(tokens, 1), 0);

  if n = 0 then return ''; end if;
  if n = 1 then return tokens[1]; end if;

  -- First particle after the first word marks where the surname begins.
  for i in 2..n loop
    if lower(regexp_replace(tokens[i], '[.''’]', '', 'g')) = any(particles) then
      surname_start := i;
      exit;
    end if;
  end loop;

  -- No particle: split on word count, rounding toward fewer given names.
  -- JS: max(1, floor(len / 2)) as a 0-based index, so +1 here.
  if surname_start is null then
    surname_start := greatest(1, n / 2) + 1;
  end if;

  given := array_to_string(tokens[1:surname_start - 1], ' ');

  for i in surname_start..n loop
    continue when lower(regexp_replace(tokens[i], '[.''’]', '', 'g')) = any(particles);
    v_initial := upper(substring(tokens[i] from '[A-Za-zÀ-ɏ]'));
    exit when v_initial is not null;
  end loop;

  if v_initial is not null then
    return given || ' ' || v_initial || '.';
  end if;
  return given;
end;
$fn$;

revoke execute on function public.public_byline(text) from public;

-- The only public read path for editorials from now on. It runs as its owner
-- (security_invoker = false), which is the point: anon reads this view without
-- holding SELECT on name. It exposes the reduced byline and nothing else about
-- the author, and only approved rows.
--
-- Careful: Supabase's default privileges grant ALL on new public relations to
-- anon and authenticated, and a view this simple is auto-updatable. Left alone
-- that would let anon UPDATE approved editorials through the owner's rights.
-- Hence revoke all, then grant SELECT only.
create or replace view public.published_editorials
with (security_invoker = false, security_barrier = true) as
select public.public_byline(e.name) as byline,
       e.title,
       e.body,
       e.submitted_at
  from public.editorial_submissions e
 where e.status = 'approved';

comment on view public.published_editorials is
  'Public editorial feed: approved rows, author reduced to "First L." by public_byline(). See migration_27.';

revoke all on public.published_editorials from public, anon, authenticated;
grant select on public.published_editorials to anon, authenticated;

-- -------------------------------------------------------------------------
-- A2. Lead 1: the staff-only path to the full row
-- -------------------------------------------------------------------------
-- After section B, authenticated holds SELECT only on the public columns, so
-- admin.html reads the review fields (name, grade, school, school_email,
-- topic, review stamps) through this function. It checks the caller is active
-- staff and refuses everyone else, so a city owner or editor gets nothing.
-- p_id narrows it to one row, which admin.js uses to redraw a card after a
-- status change.
create or replace function public.staff_editorial_submissions(p_id uuid default null)
returns setof public.editorial_submissions
language plpgsql
security definer
set search_path = public
stable
as $fn$
begin
  if not public.is_active_staff() then
    raise exception 'Only active staff can read editorial submissions.'
      using errcode = '42501';
  end if;
  return query
    select e.*
      from public.editorial_submissions e
     where p_id is null or e.id = p_id
     order by e.submitted_at desc;
end;
$fn$;

revoke execute on function public.staff_editorial_submissions(uuid) from public, anon;
grant execute on function public.staff_editorial_submissions(uuid) to authenticated;

-- -------------------------------------------------------------------------
-- A3. Lead 3: meeting children follow their meeting's published state
-- -------------------------------------------------------------------------
-- migration_22 assumed children are only reached through a meeting embed.
-- PostgREST serves them as top-level tables too, and the homepage and
-- commissioner pages read them that way. So each child's public read now
-- asks whether its parent meeting is published.
--
-- Security definer so the check sees the meeting row regardless of the
-- caller's own RLS on meetings (and does not stack policy on policy). The
-- callers are anon and authenticated, who need EXECUTE for the policy to run.
-- Staff keep drafts through their existing "Staff can manage ..." policies.
create or replace function public.meeting_is_published(p_meeting uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select exists (
    select 1 from public.meetings
     where id = p_meeting and published
  );
$fn$;

create or replace function public.meeting_item_is_published(p_item uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select exists (
    select 1
      from public.meeting_items i
      join public.meetings m on m.id = i.meeting_id
     where i.id = p_item and m.published
  );
$fn$;

revoke execute on function public.meeting_is_published(uuid) from public;
revoke execute on function public.meeting_item_is_published(uuid) from public;
grant execute on function public.meeting_is_published(uuid) to anon, authenticated;
grant execute on function public.meeting_item_is_published(uuid) to anon, authenticated;

-- Every one of these checks is a lookup by meeting_id, which had no index.
create index if not exists meeting_items_meeting_idx on public.meeting_items (meeting_id);

drop policy if exists "Public can read meeting items" on public.meeting_items;
create policy "Public can read meeting items"
  on public.meeting_items for select
  using (public.meeting_is_published(meeting_id));

drop policy if exists "Public can read item votes" on public.item_votes;
create policy "Public can read item votes"
  on public.item_votes for select
  using (public.meeting_item_is_published(item_id));

drop policy if exists "Public can read item sources" on public.item_sources;
create policy "Public can read item sources"
  on public.item_sources for select
  using (public.meeting_item_is_published(item_id));

-- -------------------------------------------------------------------------
-- A4. Lead 4: published city content is owner/staff-only to change or remove
-- -------------------------------------------------------------------------
-- migration_17 says editors write drafts and the owner publishes. The guard
-- enforced only half of that: moving INTO 'published'. Now it also covers
-- moving OUT of it, editing a published row at all, and deleting one. For an
-- editor that means a published row is read-only; the owner unpublishes it
-- first if an editor should work on it.
--
-- A trigger rather than a narrower RLS policy: an RLS-filtered delete or
-- update matches zero rows and returns no error, so js/city-admin.js would
-- report "Removed." for something that is still live. The trigger raises a
-- message the dashboard shows as is.
--
-- Same staff and service-role pass as migration_20.
create or replace function public.guard_publish_rights()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if public.is_active_staff() or public.is_service_role() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    if old.status = 'published' and not public.is_city_owner(old.city_id) then
      raise exception 'Only the city owner or staff can change or remove published content. Ask the owner to unpublish it first.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.status = 'published' and not public.is_city_owner(new.city_id) then
    raise exception 'Only the city owner or staff can publish. Save it as a draft instead.';
  end if;
  return new;
end;
$fn$;

-- Trigger functions are never called directly; nobody needs EXECUTE.
revoke execute on function public.guard_publish_rights() from public;

drop trigger if exists city_officials_guard_publish on public.city_officials;
create trigger city_officials_guard_publish
  before insert or update or delete on public.city_officials
  for each row execute function public.guard_publish_rights();

drop trigger if exists city_meetings_guard_publish on public.city_meetings;
create trigger city_meetings_guard_publish
  before insert or update or delete on public.city_meetings
  for each row execute function public.guard_publish_rights();

commit;

notify pgrst, 'reload schema';

-- After A, check (as the SQL editor's owner role):
--   The byline port, against the bylines on the live News page:
-- select name, public.public_byline(name) from public.editorial_submissions where status = 'approved';
--   The documented examples:
-- select x, public.public_byline(x) from unnest(array['Stefano Sanchez', 'Ana Maria Gonzalez Perez',
--   'Maria Gonzalez-Perez', 'Ana de la Cruz', 'Cher', '', null, 'Ángel Ñúñez', 'Ana Ángeles']) x;
--   Expected: Stefano S. / Ana Maria G. / Maria G. / Ana C. / Cher / '' / '' / Ángel Ñ. / Ana Á.
--   The view grants: only SELECT for anon and authenticated.
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'published_editorials' order by 1, 2;


-- =========================================================================
-- B. Column revokes (leads 1 and 2). Only after the new client code is live.
-- =========================================================================
-- Confirm first: news.html loads js/editorials-feed.js?v=20261015 and
-- admin.html loads js/admin.js?v=20261015 on www.miamidadecommissionwatch.com,
-- and the last Vercel build succeeded (it now reads published_editorials).

begin;

-- anon: the same columns as before, minus name. The public feed reads
-- published_editorials now; nothing public needs the raw table's name.
revoke select on public.editorial_submissions from anon;
grant select (title, body, submitted_at, status) on public.editorial_submissions to anon;

-- authenticated: the same as anon, plus id. id is needed because admin.js
-- updates and deletes by id, and a WHERE on a column needs SELECT on it; it is
-- a random uuid and says nothing about the author. status is needed for the
-- compare-and-set filter in admin.js. Staff read the full row through
-- staff_editorial_submissions(); UPDATE and DELETE stay governed by the
-- existing staff-only policies.
revoke select on public.editorial_submissions from authenticated;
grant select (id, title, body, submitted_at, status) on public.editorial_submissions to authenticated;

commit;

-- After B, check:
-- select has_column_privilege('anon',          'public.editorial_submissions', 'name',         'select') as anon_name,           -- false
--        has_column_privilege('authenticated', 'public.editorial_submissions', 'name',         'select') as auth_name,           -- false
--        has_column_privilege('authenticated', 'public.editorial_submissions', 'school_email', 'select') as auth_school_email,   -- false
--        has_table_privilege ('anon',          'public.published_editorials',  'select')                as anon_view;            -- true
-- Then: News page shows every approved editorial with the same bylines;
-- admin.html Editorials tab lists full submissions and Approve / Reject /
-- Move back to pending all redraw their card.
