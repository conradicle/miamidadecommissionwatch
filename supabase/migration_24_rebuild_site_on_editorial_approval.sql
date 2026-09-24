-- Rebuild the public site whenever an editorial goes live or comes down.
--
-- Run this once in the Supabase SQL editor, after migration_23. Then deploy
-- supabase/functions/rebuild-site (its header has the steps). Order does not
-- matter much: until the function exists the trigger's calls just 404 and
-- nothing else is affected.
--
-- Why. /news.html is a prerender (scripts/build.mjs), so an approval is
-- invisible to crawlers and no-JS readers until Vercel rebuilds. Until now the
-- rebuild was a fetch from the staff dashboard after the update, which is one
-- request from one browser tab: it did not run for a row edited in the Table
-- Editor, and on 2026-09-23 two rebuilds fired for an approval that a second
-- click had already undone. The database is the only place that sees every
-- change, so the rebuild now starts here.
--
-- Shape:
--   editorial_submissions --(trigger, only on moves into/out of 'approved')-->
--   pg_net POST --> Edge Function rebuild-site --(debounced)--> Vercel deploy hook
--
-- This is a Database Webhook in everything but the dashboard listing: the same
-- pg_net call from a row trigger. It is written in SQL rather than clicked
-- together in Database -> Webhooks for two reasons the UI cannot express: a
-- WHEN clause (so the dozens of pending <-> rejected edits never call out) and
-- a secret read from Vault instead of pasted into the trigger definition,
-- where any database role can read it back from pg_trigger. It will therefore
-- not appear on the Webhooks page; look under Database -> Triggers.
--
-- Nothing here touches RLS, the status CHECK, or the anon column grants from
-- migration_12. The trigger payload carries only id and status -- never the
-- student's name, school or email -- because pg_net keeps request and response
-- rows in the net schema for a while.

create extension if not exists pg_net with schema extensions;

-- =========================================================================
-- 1. Debounce state
-- =========================================================================
-- One row. The Edge Function is stateless and each trigger call gets its own
-- invocation, so "several approvals in a couple of minutes produce one
-- deploy" has to be decided somewhere shared. Only the service role (inside
-- the Edge Function) ever touches this.
create table if not exists public.site_rebuild_state (
  id smallint primary key default 1 check (id = 1),
  -- The newest change waiting for a deploy. The invocation holding this id
  -- is the one that deploys, unless a newer change replaces it first.
  last_request_id uuid,
  last_request_at timestamptz,
  -- First change not yet covered by a deploy; null when nothing is waiting.
  -- Caps the wait so a steady stream of approvals cannot postpone forever.
  pending_since timestamptz,
  last_deploy_at timestamptz,
  last_error text,
  last_error_at timestamptz
);

insert into public.site_rebuild_state (id) values (1) on conflict (id) do nothing;

alter table public.site_rebuild_state enable row level security;
-- No policies, on purpose: nobody but the service role reads or writes it.
revoke all on public.site_rebuild_state from anon, authenticated;

comment on table public.site_rebuild_state is
  'Debounce bookkeeping for supabase/functions/rebuild-site. Service role only. last_error shows the most recent failed deploy-hook call.';

-- Records a change and returns the id the caller should hold. Atomic, so two
-- approvals a millisecond apart cannot both think they are the newest.
create or replace function public.note_site_rebuild_request()
returns uuid
language sql
security definer
set search_path = ''
as $fn$
  update public.site_rebuild_state
     set last_request_id = gen_random_uuid(),
         last_request_at = now(),
         pending_since = coalesce(pending_since, now())
   where id = 1
  returning last_request_id;
$fn$;

-- True for exactly one caller per batch: the holder of the newest request
-- id, or anyone once the batch has waited p_max_wait_seconds. Claiming
-- clears pending_since, so every later caller in the same batch gets false.
create or replace function public.claim_site_rebuild(p_request_id uuid, p_max_wait_seconds integer)
returns boolean
language sql
security definer
set search_path = ''
as $fn$
  with claimed as (
    update public.site_rebuild_state
       set pending_since = null,
           last_deploy_at = now()
     where id = 1
       and pending_since is not null
       and (last_request_id = p_request_id
            or pending_since <= now() - make_interval(secs => p_max_wait_seconds))
    returning 1
  )
  select exists (select 1 from claimed);
$fn$;

-- Supabase's default privileges hand new functions to anon and authenticated;
-- these two are for the Edge Function alone.
revoke all on function public.note_site_rebuild_request() from public, anon, authenticated;
revoke all on function public.claim_site_rebuild(uuid, integer) from public, anon, authenticated;
grant execute on function public.note_site_rebuild_request() to service_role;
grant execute on function public.claim_site_rebuild(uuid, integer) to service_role;

-- =========================================================================
-- 2. Shared secret
-- =========================================================================
-- The Edge Function is public on the internet (it has to accept pg_net's call
-- without a user JWT), so it only acts on requests carrying this value. It is
-- generated here and lives only in Vault: the trigger reads it to send, and
-- the function reads it back through rebuild_site_webhook_secret() with the
-- service role to check. Nobody ever copies it anywhere.
do $do$
begin
  if not exists (select 1 from vault.secrets where name = 'rebuild_site_webhook_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'rebuild_site_webhook_secret',
      'Shared between the editorial rebuild trigger and the rebuild-site Edge Function. See migration_24.'
    );
  end if;
end
$do$;

create or replace function public.rebuild_site_webhook_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select decrypted_secret from vault.decrypted_secrets
   where name = 'rebuild_site_webhook_secret'
   limit 1;
$fn$;

revoke all on function public.rebuild_site_webhook_secret() from public, anon, authenticated;
grant execute on function public.rebuild_site_webhook_secret() to service_role;

-- =========================================================================
-- 3. The trigger
-- =========================================================================
-- security definer because the caller is the staff member's `authenticated`
-- session, which cannot read Vault. Every failure is swallowed with a
-- warning: a missing secret or a pg_net hiccup must never roll back the
-- approval itself. (pg_net only queues the request; the HTTP call happens
-- after commit, in the background worker.)
create or replace function public.request_site_rebuild()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'rebuild_site_webhook_secret'
   limit 1;

  if v_secret is null then
    raise warning 'request_site_rebuild: Vault secret rebuild_site_webhook_secret is missing, so the site will not rebuild on its own. See migration_24.';
    return null;
  end if;

  perform net.http_post(
    url := 'https://kpchirnlgjwdqducqdtx.supabase.co/functions/v1/rebuild-site',
    body := jsonb_build_object(
      'type', tg_op,
      'schema', tg_table_schema,
      'table', tg_table_name,
      'record', case when tg_op = 'DELETE' then null
                     else jsonb_build_object('id', new.id, 'status', new.status) end,
      'old_record', case when tg_op = 'INSERT' then null
                         else jsonb_build_object('id', old.id, 'status', old.status) end
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    timeout_milliseconds := 5000
  );
  return null;
exception when others then
  raise warning 'request_site_rebuild: could not queue the rebuild request: %', sqlerrm;
  return null;
end;
$fn$;

revoke all on function public.request_site_rebuild() from public, anon, authenticated;

-- Only changes the public page can see: into or out of 'approved'.
-- pending <-> rejected never calls out.
drop trigger if exists editorial_status_rebuilds_site on public.editorial_submissions;
create trigger editorial_status_rebuilds_site
  after update of status on public.editorial_submissions
  for each row
  when (old.status is distinct from new.status
        and (old.status = 'approved' or new.status = 'approved'))
  execute function public.request_site_rebuild();

-- api/submit-editorial pins new rows to 'pending', so this only fires for a
-- row inserted by hand already approved.
drop trigger if exists editorial_insert_rebuilds_site on public.editorial_submissions;
create trigger editorial_insert_rebuilds_site
  after insert on public.editorial_submissions
  for each row
  when (new.status = 'approved')
  execute function public.request_site_rebuild();

-- Deleting a live piece has to take it off the page too.
drop trigger if exists editorial_delete_rebuilds_site on public.editorial_submissions;
create trigger editorial_delete_rebuilds_site
  after delete on public.editorial_submissions
  for each row
  when (old.status = 'approved')
  execute function public.request_site_rebuild();
