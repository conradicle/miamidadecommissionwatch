-- MDCW content freshness pass, 2026-11-20. Backups of prior values in ../backup/.
begin;

-- Chair / Vice Chair effective 2026-11-17 (commissioner.html shows this title)
update public.commissioners set title = 'Commissioner' where slug in ('anthony-rodriguez','kionne-l-mcghee');
update public.commissioners set title = 'Chair' where slug = 'keon-hardemon';
update public.commissioners set title = 'Vice Chair' where slug = 'juan-carlos-bermudez';

-- Stefano S.: drop the trailing raw YouTube URL and the generic video sentence
update public.editorial_submissions
   set body = rtrim(regexp_replace(body, '\s*https://www\.youtube\.com/watch\?v=9YbucfyzS0M\s*This video provides local news coverage[^\n]*$', ''), E' \n\t')
 where status = 'approved'
   and title = 'The Price of Paralysis: How Miami-Dade Paid Millions to Rescue Its Ports and Prisons'
   and body like '%youtube.com/watch?v=9YbucfyzS0M%';

-- Civic Summit photo alt text to match its caption
update public.meeting_photos
   set alt_text = 'MDCW co-founders Conrad and Daniel present at the Civic Summit for Miami Youth, November 14, 2026.'
 where id = '3422f195-f50c-46a0-828d-4ac8f320ded1';

select slug, title from public.commissioners where slug in ('anthony-rodriguez','kionne-l-mcghee','keon-hardemon','juan-carlos-bermudez') order by slug;
select right(body, 160) as body_tail, (body like '%youtube%') as still_has_url from public.editorial_submissions where title like 'The Price of Paralysis%';
select alt_text from public.meeting_photos where id = '3422f195-f50c-46a0-828d-4ac8f320ded1';
commit;
