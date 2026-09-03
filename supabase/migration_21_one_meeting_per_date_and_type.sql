-- Stop two meetings of the same type existing on the same date.
--
-- Run this once in the Supabase SQL editor, after migration_20.
--
-- Why: assignMeetingPaths() in scripts/lib/render.mjs slugs same-date meetings
-- by type, so two 'Regular Meeting' rows on one date both resolve to
-- <date>-regular-meeting and the dedup loop renames one to -2. The suffix lands
-- on whichever row the query returns first, which is not stable, and the plain
-- <date>.html URL the sitemap and every inbound link point at stops being
-- written at all. The page does not break loudly -- it quietly forks in two and
-- the indexed URL goes stale.
--
-- This happened on 2026-09-02: the seeded September 1 meeting and a second one
-- entered through the dashboard sat side by side for nine hours. Nobody saw it,
-- because content only reaches the public site through a build.
--
-- A partial index rather than a plain unique constraint, so meeting_type is
-- compared case- and whitespace-insensitively -- 'Regular Meeting' and
-- 'regular meeting ' are the same meeting type to a reader, and should be to
-- the database too.

do $mig$
declare
  v_dupes int;
begin

-- Refuse to create the index while duplicates exist, and say which ones,
-- rather than failing with a bare constraint violation.
select count(*) into v_dupes
  from (
    select meeting_date, lower(btrim(meeting_type))
      from public.meetings
     group by meeting_date, lower(btrim(meeting_type))
    having count(*) > 1
  ) d;

if v_dupes > 0 then
  raise exception
    'Cannot add the constraint: % date/type pair(s) already have more than one meeting. Resolve them first: select meeting_date, meeting_type, count(*) from public.meetings group by 1,2 having count(*) > 1;',
    v_dupes;
end if;

end
$mig$;

create unique index if not exists meetings_one_per_date_and_type
  on public.meetings (meeting_date, (lower(btrim(meeting_type))));

comment on index public.meetings_one_per_date_and_type is
  'One meeting per date per type. Two rows sharing both collide in assignMeetingPaths() and orphan the /meetings/<date>.html URL. See migration_21.';

-- Verify: no date/type pair has more than one meeting.
select meeting_date, meeting_type, count(*) as rows
  from public.meetings
 group by meeting_date, meeting_type
having count(*) > 1;
