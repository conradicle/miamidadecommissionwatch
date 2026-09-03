-- Meeting Tracker: convert the September 1, 2026 BCC entry from an agenda
-- preview into a post-meeting recap.
--
-- seed_bcc_2026-09-01.sql built this meeting from the PRELIMINARY agenda, so
-- every item carries an agenda code and no outcome. The meeting has now
-- happened. This file records the outcomes that are actually sourceable and
-- leaves the rest alone.
--
-- WHAT IS AND IS NOT CONFIRMED, as of September 2, 2026
--
--   The county has not published the vote record. The Clerk's minutes are not
--   posted, and the Final Action field is still blank on every legislative
--   file from this meeting -- file 251500 (Item 7F) still reads "Second
--   Reading" with no disposition. County item statuses take days to weeks.
--
--   So the outcomes below come from same-day journalism, not from the county.
--   Only three of the eighteen tracked items have a reported result. Every
--   other item keeps its preview framing. Nothing here asserts that an item
--   passed merely because it appeared on the agenda.
--
--   Re-run this file once the minutes post, with the county's own tally
--   substituted and vote_record_url filled in.
--
-- Roll call is deliberately partial. Only four of the thirteen votes on Item
-- 7F were reported by name. item_votes therefore gets four rows, not thirteen.
-- A guessed roll call is worse than a short one: the site's own rule is that
-- every factual claim carries a source.
--
-- Re-runnable: item_sources and item_votes rows written here are deleted
-- before being re-inserted, and every update is idempotent.
--
-- Apply with the service role (Supabase SQL editor), not the anon key -- RLS
-- restricts meetings and meeting_items to staff. Then run `npm run build` to
-- regenerate meetings/2026-09-01.html, meetings.html and sitemap.xml.
--
-- ASCII only. See fix_bcc_2026-09-01_encoding.sql for why: typographic dashes
-- and curly quotes have already been corrupted in this meeting's copy once.

do $recap$
declare
  v_meeting  uuid;
  v_item     uuid;
  v_agenda   text := 'https://www.miamidade.gov/govaction/commagenda.asp?cmbmeetdate=5546&file=true&changes=true&auditor=false';
begin

select id into v_meeting
  from public.meetings
 where meeting_date = date '2026-09-01'
   and meeting_type = 'Regular Meeting';

if v_meeting is null then
  raise exception 'No Regular Meeting on 2026-09-01. Apply seed_bcc_2026-09-01.sql first.';
end if;

-- =====================================================================
-- The meeting itself: preview framing becomes recap framing
-- =====================================================================
update public.meetings
   set title = $t$Kelly Tractor clears the urban boundary, procurement rules rewritten$t$,
       summary = $t$Commissioners voted 9-3 to let Kelly Tractor build outside the Urban Development Boundary, enough to clear the mayoral veto that had stalled the project since February. They adopted four ordinances rewriting how the county awards contracts, and raised the share of the county investment portfolio that can hold Israeli government bonds from 3 percent to 5 percent without floor debate, after cutting off the residents who tried to speak against it. The county has not yet published a vote record for the rest of the agenda.$t$
 where id = v_meeting;

-- =====================================================================
-- Item row 0: "What matters"
-- =====================================================================
update public.meeting_items
   set heading = $t$What the Commission actually decided$t$,
       description = $t$Three outcomes from this meeting have been reported. Item 7F, the Kelly Tractor land-use change, passed 9-3 -- nine votes being the two-thirds supermajority needed to clear a mayoral veto. Items 5E through 5H, the four procurement ordinances, were adopted on final reading. Item 11A2, which loosens the county's investment rules for Israeli government bonds, passed without floor discussion as part of the vote setting the agenda. Item 5D, the transfer of county land to affordable-housing developers for $10, and Item 4B, the Lennar land-use application, were on the agenda but no outcome for either has been reported.$t$,
       why_it_matters = $t$The county has not published minutes or final actions for this meeting, so the outcomes above come from news coverage rather than from the county's own record. Items without a stated outcome on this page are items whose result is not yet public -- not items that failed. The official agenda linked on each item remains the authority. This page will be updated when the Clerk posts the vote record.$t$
 where meeting_id = v_meeting
   and sort_order = 0;

-- =====================================================================
-- Item 7F -- Kelly Tractor / CDMP20230013. Passed 9-3.
-- =====================================================================
update public.meeting_items
   set tag_type = 'outcome',
       tag_label = $t$Passed 9-3$t$,
       tag_status = 'passed',
       legislation_type = 'Ordinance',
       legislation_number = 'File 251500',
       vote_yes = 9,
       vote_no = 3,
       -- vote_absent stays null: twelve of thirteen commissioners are
       -- accounted for, but no source says whether the thirteenth was absent,
       -- abstaining or recused.
       vote_absent = null,
       topic = 'Zoning',
       heading = $t$Kelly Tractor can build outside the Urban Development Boundary$t$,
       description = $t$CDMP Application No. CDMP20230013, filed by Kelly Tractor Company, amends the county's long-range land-use plan for property west of the NW 137 Avenue / SR-836 interchange. The Urban Development Boundary is the line the county draws to keep development from spreading onto farmland and wetlands, and this application crosses it. Reporting describes a site of roughly 246 acres and up to 2.7 million square feet of development; Local 10 described about 140 acres of sensitive wetlands as being at issue. Conditions attached to the approval include preserving at least 63.1 acres of wetlands on the site, acquiring about 20 more acres for conservation, and placing more than 80 acres total into public ownership maintained by the company. The board approved the project 9-2 in January, Mayor Daniella Levine Cava vetoed it on February 2, and rather than override the veto the board voted to reconsider, which sent the item into deferrals until this meeting.$t$,
       why_it_matters = $t$Nine votes is two-thirds of the thirteen-member board, the threshold that makes an item veto-proof. Commissioner Raquel Regalado, widely described as the swing vote and previously opposed, voted yes and said the revised proposal puts roughly 80 acres of wetlands into public ownership. Opponents argued the applicant used a text amendment, a process with a lower threshold than a standard boundary application, and that approving it invites the next developer to do the same. The Lennar application at Item 4B on this same agenda is the next test of that question.$t$,
       official_url = 'https://www.miamidade.gov/govaction/matter.asp?matter=251500&file=true&fileAnalysis=false&yearFolder=Y2025',
       official_label = 'County legislative record -- file 251500',
       agenda_document_url = v_agenda
 where meeting_id = v_meeting
   and sort_order = 40
returning id into v_item;

if v_item is null then
  raise exception 'Item row sort_order 40 (Item 7F) not found on the 2026-09-01 meeting.';
end if;

delete from public.item_sources where item_id = v_item;
insert into public.item_sources (item_id, sort_order, outlet, label, url, published_on) values
  (v_item, 0, 'Local 10',
   'Commissioners give green light for controversial Kelly Tractor UDB expansion',
   'https://www.local10.com/news/local/2026/09/01/miami-dade-commissioners-give-green-light-for-controversial-kelly-tractor-udb-expansion/',
   date '2026-09-01'),
  (v_item, 1, 'The Real Deal',
   'Kelly Tractor''s HQ outside development boundary approved',
   'https://therealdeal.com/miami/2026/09/01/kelly-tractors-hq-outside-development-boundary-approved/',
   date '2026-09-01'),
  (v_item, 2, 'Hoodline',
   'Miami-Dade approves Kelly Tractor wetlands expansion in 9-3 vote',
   'https://hoodline.com/2026/09/miami-dade-commissioners-approve-kelly-tractor-s-wetlands-expansion-in-9-3-vote/',
   null),
  (v_item, 3, 'Political Cortadito',
   'Levine Cava vetoes approval of Kelly Tractor complex across UDB',
   'https://www.politicalcortadito.com/2026/02/02/daniella-levine-cava-veto-kelly-tractor-udb/',
   date '2026-02-02'),
  (v_item, 4, 'Political Cortadito',
   'Kelly Tractor showdown delayed as commission sidesteps veto',
   'https://www.politicalcortadito.com/2026/02/19/kelly-tractor-miami-dade-commission-sidesteps-veto/',
   date '2026-02-19');

-- Roll call: four of thirteen. The three no votes are named by The Real Deal,
-- with Cohen Higgins corroborated by Local 10. Regalado's yes is reported
-- directly, with a quote, in both. The remaining nine commissioners are not
-- named by any source consulted, so they get no row rather than a guess.
delete from public.item_votes where item_id = v_item;
insert into public.item_votes (item_id, commissioner_id, vote)
select v_item, c.id, v.vote
  from (values
    ('raquel-a-regalado',      'yes'),
    ('danielle-cohen-higgins', 'no'),
    ('vicki-l-lopez',          'no'),
    ('micky-steinberg',        'no')
  ) as v(slug, vote)
  join public.commissioners c on c.slug = v.slug;

-- =====================================================================
-- Items 5E-5H -- the STRIP procurement package. Adopted.
-- =====================================================================
update public.meeting_items
   set tag_type = 'outcome',
       tag_label = $t$Passed$t$,
       tag_status = 'passed',
       legislation_type = 'Ordinance',
       -- No tally was reported for these four, so the aggregate vote columns
       -- stay null and the badge reads "Passed" rather than "Passed X-Y".
       heading = $t$Four ordinances rewriting how the county buys things were adopted$t$,
       description = $t$The board adopted the legislative package from its Special Task Force to Reduce Inefficiencies in Procurement, known as STRIP, which it created in May 2025. The substitute versions were the ones taken up. Reported changes across the four: a five-day window to object after the first step of a two-step qualifications-based procurement; recovery of attorney's fees against frivolous bid protests on procurements over $25 million; motions to dismiss allowed in protest proceedings; the informal-protest threshold raised to $5 million; and a single automated online portal for filing protests, with firm electronic deadlines. The stated goal is to cut the time to award a contract from as long as 349 days to roughly 120 to 150 days.$t$,
       why_it_matters = $t$Miami-Dade awards contracts worth billions, and these are the rules deciding who can compete and who can object to a decision. The reforms move in two directions at once: a centralized portal makes protests easier to file and easier for the public to see, while fee-shifting and a higher informal threshold raise the cost of bringing one. Whether that speeds up procurement without narrowing the field of companies willing to challenge an award is the thing to watch as the first contracts run under the new rules.$t$
 where meeting_id = v_meeting
   and sort_order = 10
returning id into v_item;

if v_item is null then
  raise exception 'Item row sort_order 10 (Items 5E-5H) not found on the 2026-09-01 meeting.';
end if;

delete from public.item_sources where item_id = v_item;
insert into public.item_sources (item_id, sort_order, outlet, label, url, published_on) values
  (v_item, 0, 'Hoodline',
   'Miami-Dade slashes procurement wait from 349 days to as few as 120',
   'https://hoodline.com/2026/09/miami-dade-slashes-procurement-wait-from-349-days-to-as-few-as-120/',
   null),
  (v_item, 1, 'Miami-Dade County',
   'Special Task Force to Reduce Inefficiencies in Procurement (STRIP)',
   'https://www.miamidade.gov/global/strategic-procurement/strip.page',
   null);

-- =====================================================================
-- Item 11A2 -- investment policy / Israeli government bonds. Adopted.
-- =====================================================================
update public.meeting_items
   set tag_type = 'outcome',
       tag_label = $t$Passed$t$,
       tag_status = 'passed',
       legislation_type = 'Resolution',
       legislation_number = 'File 261175',
       sponsor = 'Rene Garcia',
       topic = 'Taxes & Budget',
       heading = $t$Investment rules loosened for Israeli government bonds, with no floor debate$t$,
       description = $t$The resolution amends the county's Investment Policy. It raises the share of the portfolio, roughly $8 billion, that may be held in Israeli government debt from 3 percent to 5 percent; removes the requirement that those bonds carry an "A" rating or better; shortens their maximum maturity from five years to three; removes a provision requiring board approval before investing; and updates references made obsolete by the county's Amendment 10 transition to independent constitutional offices. The rating change tracks a 2025 amendment to section 218.415, Florida Statutes, which lets local governments hold rated or unrated instruments backed by the full faith and credit of the government of Israel. Purchases are made by the Clerk, not the board. Holdings are reported inconsistently: Prism put them at about $130 million, or 1.5 percent of the portfolio, as of June 2026; WLRN and Hoodline reported roughly $151 million before the change, up from $76 million in late 2023.$t$,
       why_it_matters = $t$The item was not debated. It passed inside the vote that sets the agenda, and residents who came to speak against it were not allowed to: under the commission's rules there is no public comment at the full board on an item already heard in committee, and this one was heard on July 15. Several people tried anyway, had their microphones cut, and were escorted out. Whatever a resident thinks of the investment itself, the procedural question is separate and it recurs: a committee hearing weeks earlier is, under current rules, the only chance the public gets on items like this one.$t$,
       official_url = 'https://www.miamidade.gov/govaction/matter.asp?matter=261175&file=true&fileAnalysis=false&yearFolder=Y2026',
       official_label = 'County legislative record -- file 261175',
       agenda_document_url = v_agenda
 where meeting_id = v_meeting
   and sort_order = 120
returning id into v_item;

if v_item is null then
  raise exception 'Item row sort_order 120 (Item 11A2) not found on the 2026-09-01 meeting.';
end if;

delete from public.item_sources where item_id = v_item;
insert into public.item_sources (item_id, sort_order, outlet, label, url, published_on) values
  (v_item, 0, 'Local 10',
   'Speakers escorted out as commission votes to increase cap on Israel Bonds',
   'https://www.local10.com/news/local/2026/09/01/speakers-escorted-out-as-miami-dade-commission-votes-to-increase-cap-on-israel-bonds/',
   date '2026-09-01'),
  (v_item, 1, 'Prism',
   'Miami-Dade County votes to allow more investment in Israel bonds',
   'https://prismreports.org/2026/09/01/miami-dade-israel-bonds/',
   date '2026-09-01'),
  (v_item, 2, 'Florida Politics',
   'Mics cut, speakers ejected after commission raises Israeli bond cap',
   'https://floridapolitics.com/archives/817948-mics-cut-speakers-ejected-after-miami-dade-commission-raises-israeli-bond-cap/',
   date '2026-09-01'),
  (v_item, 3, 'Hoodline',
   'Fishback denounces Israel bonds, gets hauled out of Miami-Dade chambers',
   'https://hoodline.com/2026/09/fishback-denounces-israel-bonds-gets-hauled-out-of-miami-dade-chambers/',
   null);

end
$recap$;

-- =====================================================================
-- After running this file
-- =====================================================================
-- 1. Run `npm run build` and commit the regenerated meetings/2026-09-01.html,
--    meetings.html and sitemap.xml.
-- 2. Check the Clerk's minutes for this meeting. When they post, replace the
--    journalism-sourced tallies with the county's own, fill vote_record_url on
--    all three items, complete the Item 7F roll call to thirteen rows, and
--    record outcomes for the fifteen items still carrying preview framing.
-- 3. Item 4B (Lennar, CDMP20250021) was first reading only. Its public hearing
--    date is set by Item 15B1 on this same agenda -- worth its own entry when
--    that date is known.
