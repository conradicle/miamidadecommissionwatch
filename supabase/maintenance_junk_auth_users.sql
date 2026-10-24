-- Miami-Dade Commission Watch: find (and, separately, delete) scanner-made
-- auth accounts. Run in the Supabase SQL editor.
--
-- A junk account is one that:
--   * signed itself up (invited_at is null: every real account came from the
--     staff invite or a claim/invite approval, which set invited_at),
--   * has no user_roles row (any status), and
--   * has no city_memberships row.
-- The three founder addresses are excluded whatever their state.
--
-- Free tier has no backups. Section 2 returns every deleted row; save that
-- output before closing the tab.

-- ---------------------------------------------------------------------
-- 1. LIST. Read-only. Run this, review it, and only then run section 2.
-- ---------------------------------------------------------------------
select u.id, u.email, u.created_at, u.last_sign_in_at,
       u.email_confirmed_at is not null as confirmed,
       u.raw_app_meta_data->>'provider' as provider
  from auth.users u
 where u.invited_at is null
   and not exists (select 1 from public.user_roles r where r.user_id = u.id)
   and not exists (select 1 from public.city_memberships m where m.user_id = u.id)
   and lower(coalesce(u.email, '')) not in (
         'cagelber1@gmail.com',
         'daniel.llobet.v@gmail.com',
         'conrad@miamidadecommissionwatch.com')
 order by u.created_at;

-- ---------------------------------------------------------------------
-- 2. DELETE. Same filter, in one transaction, refusing to run if the count
--    is not the one you approved from section 1. Set expected_count first.
--    Deleting from auth.users cascades to auth.identities, sessions and
--    refresh tokens, so their logins die immediately.
-- ---------------------------------------------------------------------
-- begin;
--
-- create temp table junk on commit drop as
-- select u.id, u.email, u.created_at, u.last_sign_in_at,
--        u.email_confirmed_at, u.raw_user_meta_data
--   from auth.users u
--  where u.invited_at is null
--    and not exists (select 1 from public.user_roles r where r.user_id = u.id)
--    and not exists (select 1 from public.city_memberships m where m.user_id = u.id)
--    and lower(coalesce(u.email, '')) not in (
--          'cagelber1@gmail.com',
--          'daniel.llobet.v@gmail.com',
--          'conrad@miamidadecommissionwatch.com');
--
-- do $$
-- declare
--   expected_count int := 0;  -- <- the row count you approved from section 1
--   actual int;
-- begin
--   select count(*) into actual from junk;
--   if actual <> expected_count then
--     raise exception 'Expected % junk accounts, found %. Nothing deleted.', expected_count, actual;
--   end if;
-- end $$;
--
-- select * from junk order by created_at;        -- save this output
-- delete from auth.users where id in (select id from junk);
--
-- commit;
