-- Miami-Dade Commission Watch: the municipality registry and claim intake.
-- Run in the Supabase SQL editor AFTER migration_17. Safe to re-run.
--
-- Three changes, all of them consequences of the claim flow existing:
--
-- 1. governance becomes nullable. migration_17 made it NOT NULL so that no
--    city could exist without someone having decided how its seats are
--    elected. That is right for a city being published and wrong for the
--    registry: most Miami-Dade municipalities are listed as unclaimed and
--    nobody has read their charter yet. Null now means "not yet established",
--    which is the honest value, and a CHECK keeps a city from going 'active'
--    while it is still null.
--
-- 2. anon loses INSERT on claim_requests. migration_17 let the public write a
--    claim straight through PostgREST. That works, but it cannot be rate
--    limited and it cannot send the notification email, so intake moves to
--    /api/submit-claim, which runs with the service role, checks the rate
--    limit, and emails. Nothing anonymous writes to this table any more.
--
-- 3. All 34 municipalities are seeded as 'unclaimed'.

begin;

-- ---------- 1. governance is optional until a city goes live ----------
alter table public.cities alter column governance drop not null;

alter table public.cities drop constraint if exists cities_active_needs_governance;
alter table public.cities add constraint cities_active_needs_governance
  check (status <> 'active' or governance is not null);

comment on column public.cities.governance is
  'How the seats are elected. NULL means not yet established -- the registry '
  'lists most municipalities before anyone has checked the charter. A city '
  'cannot become active while this is NULL, because the map cannot render '
  'honestly without it.';

-- ---------- 2. claim intake moves behind the API ----------
revoke insert on public.claim_requests from anon;

drop policy if exists "Anyone can file a claim" on public.claim_requests;

-- ---------- 3. the municipalities ----------
-- The 34 incorporated municipalities of Miami-Dade County. This list is the
-- public registry behind /municipalities.html; each row starts unclaimed, with
-- no governance recorded, and gains both when a claim is approved.
--
-- VERIFY BEFORE PROMOTING: names here are the common forms, and a few carry a
-- formal prefix ('Village of Key Biscayne', 'Town of Surfside'). The slug is
-- what becomes the subdomain, so it is deliberately short and unpunctuated.
insert into public.cities (slug, name, status, is_published, sort_order) values
  ('aventura',          'Aventura',            'unclaimed', false, 100),
  ('balharbour',        'Bal Harbour',         'unclaimed', false, 110),
  ('bayharborislands',  'Bay Harbor Islands',  'unclaimed', false, 120),
  ('biscaynepark',      'Biscayne Park',       'unclaimed', false, 130),
  ('coralgables',       'Coral Gables',        'unclaimed', false, 140),
  ('cutlerbay',         'Cutler Bay',          'unclaimed', false, 150),
  ('doral',             'Doral',               'unclaimed', false, 160),
  ('elportal',          'El Portal',           'unclaimed', false, 170),
  ('floridacity',       'Florida City',        'unclaimed', false, 180),
  ('goldenbeach',       'Golden Beach',        'unclaimed', false, 190),
  ('hialeahgardens',    'Hialeah Gardens',     'unclaimed', false, 200),
  ('homestead',         'Homestead',           'unclaimed', false, 210),
  ('indiancreek',       'Indian Creek',        'unclaimed', false, 220),
  ('keybiscayne',       'Key Biscayne',        'unclaimed', false, 230),
  ('medley',            'Medley',              'unclaimed', false, 240),
  ('miami',             'Miami',               'unclaimed', false, 250),
  ('miamigardens',      'Miami Gardens',       'unclaimed', false, 260),
  ('miamilakes',        'Miami Lakes',         'unclaimed', false, 270),
  ('miamishores',       'Miami Shores',        'unclaimed', false, 280),
  ('miamisprings',      'Miami Springs',       'unclaimed', false, 290),
  ('northbayvillage',   'North Bay Village',   'unclaimed', false, 300),
  ('northmiami',        'North Miami',         'unclaimed', false, 310),
  ('northmiamibeach',   'North Miami Beach',   'unclaimed', false, 320),
  ('opalocka',          'Opa-locka',           'unclaimed', false, 330),
  ('palmettobay',       'Palmetto Bay',        'unclaimed', false, 340),
  ('pinecrest',         'Pinecrest',           'unclaimed', false, 350),
  ('southmiami',        'South Miami',         'unclaimed', false, 360),
  ('sunnyislesbeach',   'Sunny Isles Beach',   'unclaimed', false, 370),
  ('surfside',          'Surfside',            'unclaimed', false, 380),
  ('sweetwater',        'Sweetwater',          'unclaimed', false, 390),
  ('virginiagardens',   'Virginia Gardens',    'unclaimed', false, 400),
  ('westmiami',         'West Miami',          'unclaimed', false, 410)
on conflict (slug) do nothing;

-- miamibeach and hialeah are already seeded as active by migration_17; the
-- ON CONFLICT above leaves them alone rather than reverting them to unclaimed.

commit;

-- ---------- After running this file ----------
-- 1. /municipalities.html lists all 34 with their status.
-- 2. Claims arrive through /api/submit-claim, which needs RESEND_API_KEY and
--    CLAIM_NOTIFICATION_EMAIL set in the Vercel project.
-- 3. Approving a claim in the dashboard sets governance; until someone does,
--    the constraint above stops the city going active without it.
