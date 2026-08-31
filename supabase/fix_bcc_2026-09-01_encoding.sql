-- Repair the September 1, 2026 BCC meeting copy.
--
-- The rows loaded into Supabase had every em and en dash corrupted: UTF-8
-- was read as Mac Roman, so each dash became three stray characters. This
-- rewrites the affected fields with punctuation chosen per sentence rather
-- than restoring the dashes, and leaves the meeting text pure ASCII so no
-- future encoding round trip can damage it again.
--
-- Keyed on sort_order, which the seed file hardcodes, so this stays correct
-- even if the seed is re-run and the row ids change.
--
-- Apply with the service role (Supabase SQL editor).

update public.meeting_items i set
  tag_label = 'Items 5E-5H'
from public.meetings m
where i.meeting_id = m.id
  and m.meeting_date = '2026-09-01'
  and i.sort_order = 10;

update public.meeting_items i set
  description = 'CDMP Application No. CDMP20250021, filed by Lennar Homes LLC, would amend the Comprehensive Development Master Plan (the county''s long-range map of what may be built where) for property generally between SW 272 Street and SW 278 Street and between SW 157 Avenue and SW 159 Avenue. The agenda does not describe a specific building project, so neither does this summary.'
from public.meetings m
where i.meeting_id = m.id
  and m.meeting_date = '2026-09-01'
  and i.sort_order = 30;

update public.meeting_items i set
  why_it_matters = 'Repeated deferrals are a normal part of how contested land-use applications move, or stall, at the county, and following one shows how slowly the long-range plan actually changes. As with any land-use change beside a major highway interchange, the questions worth asking are about traffic, infrastructure capacity and drainage.'
from public.meetings m
where i.meeting_id = m.id
  and m.meeting_date = '2026-09-01'
  and i.sort_order = 40;

update public.meeting_items i set
  description = 'The ordinance would expand the Smart Corridor subzone of the county''s Rapid Transit Zone to cover certain private property near SW 30 Avenue and SW 28 Lane, within a quarter-mile of a public transit station. It creates a process for public-benefit "proffers" (things a property owner offers to the public as part of a project) and allows development bonuses, meaning permission to build more than the base rules would otherwise allow.'
from public.meetings m
where i.meeting_id = m.id
  and m.meeting_date = '2026-09-01'
  and i.sort_order = 50;

update public.meeting_items i set
  tag_label = 'Items 8A1-8A3',
  description = 'Three separate construction contract approvals at county-run airports. Item 8A1 is the Taxiway C East Extension at Miami Executive Airport, for up to $27,202,351.18. Item 8A2 is runway incursion mitigation at Miami-Opa Locka Executive Airport, for up to $10,541,788.93. That work is meant to reduce the chance of an aircraft or vehicle ending up on a runway when it should not be there. Item 8A3 is Phase 1 of a fuel storage facility expansion at Miami International Airport, for up to $45,856,233.51.'
from public.meetings m
where i.meeting_id = m.id
  and m.meeting_date = '2026-09-01'
  and i.sort_order = 70;

update public.meeting_items i set
  tag_label = 'Items 8A4-8A5',
  description = 'The county is not selling this land. It is leasing it and collecting rent. Item 8A4 is a development lease with Air Sal covering approximately 457,966 square feet of county-owned land, for a 30-year term with a five-year renewal option, for aviation hangars, an FBO terminal (the private-aviation counterpart to a passenger terminal) and ancillary infrastructure; the county estimates $14,170,511 in rent and other revenue over the initial 30 years. Item 8A5 expands an existing KASE development lease from approximately 435,884 to 645,088 square feet, also for 30 years with a five-year renewal option, for hangar facilities, an FBO terminal, a fuel farm and ancillary infrastructure, with an estimated $17,612,737 in rent and other revenue over the initial 30 years.'
from public.meetings m
where i.meeting_id = m.id
  and m.meeting_date = '2026-09-01'
  and i.sort_order = 80;

update public.meeting_items i set
  tag_label = 'Items 8O1-8O5',
  why_it_matters = 'Much of Miami-Dade''s water and sewer program over the past decade has been shaped by a federal Consent Decree, the court-supervised agreement requiring the county to repair its sewer system. These items show what that kind of work looks like in practice (treatment plants, chemical storage and pipes), and they show what happens to contracts after they are signed. One adds money, two add time at no additional cost, and one adds nearly two years to a wastewater plant schedule. Changes like these are ordinary in large construction; tracking them is how residents can tell whether a program is on course.'
from public.meetings m
where i.meeting_id = m.id
  and m.meeting_date = '2026-09-01'
  and i.sort_order = 90;

update public.meeting_items i set
  description = 'The county would acquire approximately 10 acres for the South Dade Wetlands Project under the Environmentally Endangered Lands Program, the county program that buys ecologically significant land to keep it undeveloped. The purchase price is $3.5 million, paid from Building Better Communities General Obligation Bond funds. The Nature Conservancy is involved as assignor, and the seller is the estate of Rachel M. Noto. The property is at approximately SW 344 Street and SW 169 Avenue, folio 16-7930-001-0050, and sits inside the Urban Development Boundary, the line separating where the county allows urban development from where it does not.'
from public.meetings m
where i.meeting_id = m.id
  and m.meeting_date = '2026-09-01'
  and i.sort_order = 100;

update public.meeting_items i set
  description = 'The resolution would amend the county''s investment policy, changing which types of investments are authorized and removing a requirement that the Board approve investments in the Local Government Surplus Funds Trust Fund, a state-run pool where Florida local governments hold short-term cash.'
from public.meetings m
where i.meeting_id = m.id
  and m.meeting_date = '2026-09-01'
  and i.sort_order = 120;

update public.meeting_items i set
  description = 'The resolution would direct the Mayor to consider recommendations from a county agriculture report and to pursue a possible amendment to the Comprehensive Development Master Plan encouraging high-intensity, closed agricultural systems (vertical farming and similar indoor growing) within urbanized areas. It directs study and a possible next step; on its own it changes no land-use rule.'
from public.meetings m
where i.meeting_id = m.id
  and m.meeting_date = '2026-09-01'
  and i.sort_order = 150;

update public.meeting_items i set
  description = 'Two separate on-demand transportation agreements (one with Doral, one with North Miami) for the app-hailed shuttle model that works more like a shared ride than a fixed bus route. Where applicable, the cities'' share of the Charter County Transportation System Surtax helps pay for the service.'
from public.meetings m
where i.meeting_id = m.id
  and m.meeting_date = '2026-09-01'
  and i.sort_order = 160;
