-- Meeting Tracker content: Miami-Dade Board of County Commissioners,
-- Tuesday, September 1, 2026, 9:30 AM, Commission Chambers.
-- County meeting key 5546.
--
-- This is a preview built from the county's PRELIMINARY agenda, the same way
-- the June 2 entry was: items carry agenda codes rather than outcomes, because
-- nothing has been voted on yet.
--
-- The agenda runs 61 pages. What is here is the substantive business a
-- resident would want to know about -- not invocation, roll call, pledge,
-- citizen presentations, generic office placeholders, clerk procedure,
-- appointment boilerplate, discretionary allocations, ceremonial naming,
-- routine plat approvals, or adjournment.
--
-- Re-runnable: the delete cascades to meeting_items, item_sources and
-- item_votes, so running this file twice leaves exactly one copy.
--
-- Apply with the service role (Supabase SQL editor), not the anon key --
-- RLS restricts meetings and meeting_items to staff.

do $seed$
declare
  v_meeting uuid;
  v_agenda  text := 'https://www.miamidade.gov/govaction/commagenda.asp?cmbmeetdate=5546&file=true&changes=true&auditor=false';
begin

delete from public.meetings
 where meeting_date = date '2026-09-01'
   and meeting_type = 'Regular Meeting';

insert into public.meetings (meeting_date, meeting_type, title, summary)
values (
  date '2026-09-01',
  'Regular Meeting',
  $t$Procurement overhaul, $10 land for housing, big airport contracts$t$,
  $t$Commissioners take up four ordinances rewriting how Miami-Dade awards contracts, a proposal to transfer county-owned land to two affordable-housing developers for $10, and more than $83 million in airport construction work. The meeting starts at 9:30 a.m. in Commission Chambers.$t$
)
returning id into v_meeting;

-- ---------------------------------------------------------------------
-- Items, in the order a reader should meet them.
-- ---------------------------------------------------------------------
insert into public.meeting_items (
  meeting_id, sort_order, tag_type, tag_label, tag_status,
  item_code, legislation_type, amount_usd, topic, districts,
  heading, description, why_it_matters,
  official_url, official_label
) values

-- 0 -- What matters -------------------------------------------------------
(v_meeting, 0, 'item_code', 'What matters', null,
 null, null, null, null, '{}',
 $t$The decisions worth knowing about at this meeting$t$,
 $t$Eight things stand out on a 61-page agenda. Four ordinances (Items 5E, 5F, 5G and 5H) would rewrite the county's procurement rules, on their final reading. Item 5D would transfer county-owned land to two affordable-housing developers for $10. Items 4B and 7F would change the county's long-range land-use plan for two private applicants. Item 7D would allow more development near a transit station in exchange for public benefits. Item 8N4 asks for $3,896,702 tied to buses bought for an express bus service that no longer runs. Items 8A1 through 8A5 cover more than $83 million in airport construction plus two 30-year land leases. Items 8O1 through 8O5 cover water and sewer work, including added money and added time. And Item 9A1 would spend $3.5 million in bond money to buy about 10 acres of South Dade wetlands for conservation.$t$,
 $t$Everything below comes from the county's preliminary agenda, published before the meeting. Items are regularly deferred, amended or withdrawn, so the official agenda linked on each item is the authority on what actually happens. Smaller items are gathered under "Other notable items" further down this page.$t$,
 v_agenda, 'Official meeting agenda'),

-- 1 -- Procurement reform package ----------------------------------------
(v_meeting, 10, 'item_code', 'Items 5E-5H', null,
 'Items 5E, 5F, 5G, 5H', 'Ordinance', null, 'Other', '{}',
 $t$Four ordinances that would rewrite how the county buys things$t$,
 $t$These four ordinances put into practice recommendations from the county's Special Task Force to Reduce Inefficiencies in Procurement. Together they would change how a losing bidder challenges a contract award, including a single automated online portal for filing protests; adjust the requirements meant to steer work toward small and local businesses, and add a new "large local employer" category; tighten rules on conflicts of interest, subcontracting, bidding by related companies, and bid collusion; change the "cone of silence," the period when bidders may not talk privately with county staff and commissioners about a pending contract; set rules for the committees that score competing proposals, including their training and conflict checks; and change how oral presentations by bidders work in competitive selections. All four were adopted on first reading. September 1 is the public hearing and second reading, the final vote before they take effect.$t$,
 $t$Miami-Dade awards contracts worth billions of dollars, and these are the rules that decide who can compete, who can object to a decision, and what has to be disclosed along the way. Fair questions for a resident: does a centralized protest portal make challenges easier to see and track, and do the small-business and "large local employer" changes widen or narrow the field of companies that can win county work?$t$,
 v_agenda, 'Official meeting agenda'),

-- 2 -- County land for $10 ------------------------------------------------
(v_meeting, 20, 'item_code', 'Item 5D', null,
 'Item 5D', 'Resolution', 10, 'Housing', '{}',
 $t$County-owned land would go to two affordable-housing developers for $10$t$,
 $t$The resolution would declare certain county-owned properties surplus and convey them to Habitat for Humanity of Greater Miami and Elite Equity Development for $10, with the stated purpose of developing affordable housing for very-low-, low- and moderate-income households. The county would carry out due diligence before the transfer, and the deeds would carry requirements tied to that affordable-housing purpose. The resolution also asks the Board to waive several of the county's normal requirements for disposing of property.$t$,
 $t$Public land is a one-time asset: once it is conveyed, the county does not get it back. The straightforward accountability question is what the public receives in exchange for a $10 transfer, and how the county makes sure the promised affordable housing is actually built. Both answers live in the deed requirements and in which normal disposition rules the Board agrees to waive.$t$,
 v_agenda, 'Official meeting agenda'),

-- 3 -- CDMP 4B ------------------------------------------------------------
(v_meeting, 30, 'item_code', 'Item 4B', null,
 'Item 4B', null, null, 'Zoning', '{}',
 $t$Lennar asks to change the county's long-range land-use plan in South Dade$t$,
 $t$CDMP Application No. CDMP20250021, filed by Lennar Homes LLC, would amend the Comprehensive Development Master Plan (the county's long-range map of what may be built where) for property generally between SW 272 Street and SW 278 Street and between SW 157 Avenue and SW 159 Avenue. The agenda does not describe a specific building project, so neither does this summary.$t$,
 $t$The CDMP is the document that governs where growth is allowed in Miami-Dade. It changes one application at a time, and each change is how the map shifts over the long run. The practical questions neighbors tend to raise are what a change means for traffic, school capacity, drainage and flooding, water and sewer capacity, and pressure on nearby agricultural and environmental land.$t$,
 v_agenda, 'Official meeting agenda'),

-- 4 -- CDMP 7F ------------------------------------------------------------
(v_meeting, 40, 'item_code', 'Item 7F', null,
 'Item 7F', null, null, 'Zoning', '{}',
 $t$A repeatedly deferred land-use change near the SR-836 interchange returns$t$,
 $t$CDMP Application No. CDMP20230013, filed by Kelly Tractor Company, would amend the county's long-range land-use plan for property west of the NW 137 Avenue / SR-836 interchange and north of theoretical NW 6 Street. The application has a lengthy procedural history and has been deferred repeatedly, which is why an application numbered in 2023 is still on an agenda in 2026.$t$,
 $t$Repeated deferrals are a normal part of how contested land-use applications move, or stall, at the county, and following one shows how slowly the long-range plan actually changes. As with any land-use change beside a major highway interchange, the questions worth asking are about traffic, infrastructure capacity and drainage.$t$,
 v_agenda, 'Official meeting agenda'),

-- 5 -- Smart Corridor / Rapid Transit Zone --------------------------------
(v_meeting, 50, 'item_code', 'Item 7D', null,
 'Item 7D', 'Ordinance', null, 'Zoning', '{}',
 $t$More development allowed near a transit station, in exchange for public benefits$t$,
 $t$The ordinance would expand the Smart Corridor subzone of the county's Rapid Transit Zone to cover certain private property near SW 30 Avenue and SW 28 Lane, within a quarter-mile of a public transit station. It creates a process for public-benefit "proffers" (things a property owner offers to the public as part of a project) and allows development bonuses, meaning permission to build more than the base rules would otherwise allow.$t$,
 $t$This is the point where transit policy and development policy meet. Building more homes and workplaces close to transit is a stated county goal, and the trade here is explicit: extra development capacity in exchange for something offered back to the public. The two questions residents may care about are how much additional development the change makes possible, and what specific public benefits the county receives in return.$t$,
 v_agenda, 'Official meeting agenda'),

-- 6 -- I-95 Express Bus reimbursement -------------------------------------
(v_meeting, 60, 'item_code', 'Item 8N4', null,
 'Item 8N4', null, 3896702, 'Transit', '{}',
 $t$$3,896,702 tied to 15 buses bought for a service that no longer runs$t$,
 $t$The county is asked to use $3,896,702 from the Charter County Transportation Surtax Bond Program to reimburse the Department of Transportation and Public Works operating fund for a payment made to the Florida Department of Transportation. The payment is associated with 15 buses originally purchased for the I-95 Express Bus service, which has since been discontinued. The item references the buses' depreciated value and unauthorized mileage.$t$,
 $t$This is public money covering a cost left over from a service that ended. The agenda does not explain how the mileage came to be unauthorized or who decided the buses would be used differently, and this page does not assume. The reasonable questions are what the $3,896,702 is actually paying for, and what the county has changed so that the same situation does not repeat with the next set of buses.$t$,
 v_agenda, 'Official meeting agenda'),

-- 7 -- Airport construction contracts -------------------------------------
(v_meeting, 70, 'item_code', 'Items 8A1-8A3', null,
 'Items 8A1, 8A2, 8A3', null, null, 'Taxes & Budget', '{}',
 $t$More than $83 million in airport construction contracts$t$,
 $t$Three separate construction contract approvals at county-run airports. Item 8A1 is the Taxiway C East Extension at Miami Executive Airport, for up to $27,202,351.18. Item 8A2 is runway incursion mitigation at Miami-Opa Locka Executive Airport, for up to $10,541,788.93. That work is meant to reduce the chance of an aircraft or vehicle ending up on a runway when it should not be there. Item 8A3 is Phase 1 of a fuel storage facility expansion at Miami International Airport, for up to $45,856,233.51.$t$,
 $t$Miami-Dade owns and operates its airports, so the Board votes on their construction contracts the same way it votes on roads or water plants. These three together come to more than $83 million approved in a single meeting, and the Board is the body signing off on both the price and the scope of the work.$t$,
 v_agenda, 'Official meeting agenda'),

-- 8 -- Airport development leases -----------------------------------------
(v_meeting, 80, 'item_code', 'Items 8A4-8A5', null,
 'Items 8A4, 8A5', null, null, 'Taxes & Budget', '{}',
 $t$Two 30-year leases of county land at Miami Executive Airport$t$,
 $t$The county is not selling this land. It is leasing it and collecting rent. Item 8A4 is a development lease with Air Sal covering approximately 457,966 square feet of county-owned land, for a 30-year term with a five-year renewal option, for aviation hangars, an FBO terminal (the private-aviation counterpart to a passenger terminal) and ancillary infrastructure; the county estimates $14,170,511 in rent and other revenue over the initial 30 years. Item 8A5 expands an existing KASE development lease from approximately 435,884 to 645,088 square feet, also for 30 years with a five-year renewal option, for hangar facilities, an FBO terminal, a fuel farm and ancillary infrastructure, with an estimated $17,612,737 in rent and other revenue over the initial 30 years.$t$,
 $t$Thirty years is longer than most commitments the county makes, and between them these two leases put more than a million square feet of public airport land into private development for that period. The revenue figures are estimates over three decades, not guaranteed income. Worth asking: how the rent compares with what the land is worth, and what the leases require if the projected revenue does not materialize.$t$,
 v_agenda, 'Official meeting agenda'),

-- 9 -- Water and sewer package --------------------------------------------
(v_meeting, 90, 'item_code', 'Items 8O1-8O5', null,
 'Items 8O1 through 8O5', null, null, 'Environment', '{}',
 $t$Five water and sewer items: new storage, added money, added time$t$,
 $t$A package of five Water and Sewer Department items. Together they cover a $13,981,325 supplemental storage facility for sodium hypochlorite, the chemical used to disinfect drinking water; a $1,629,590 reallocation plus a $2,003,650 contract increase for emergency operational and resiliency improvements at the Alexander Orr Water Treatment Plant; a 699-day time extension for an expansion package at the South District Wastewater Treatment Plant; a $921,749.03 net-zero fund reallocation and a 682-day extension at no additional cost for a water-main project on NW 106 Street; and a $2,754,126.76 net-zero reallocation with a 12-day extension for electrical upgrades at the John E. Preston Water Treatment Plant.$t$,
 $t$Much of Miami-Dade's water and sewer program over the past decade has been shaped by a federal Consent Decree, the court-supervised agreement requiring the county to repair its sewer system. These items show what that kind of work looks like in practice (treatment plants, chemical storage and pipes), and they show what happens to contracts after they are signed. One adds money, two add time at no additional cost, and one adds nearly two years to a wastewater plant schedule. Changes like these are ordinary in large construction; tracking them is how residents can tell whether a program is on course.$t$,
 v_agenda, 'Official meeting agenda'),

-- 10 -- EEL / South Dade Wetlands -----------------------------------------
(v_meeting, 100, 'item_code', 'Item 9A1', null,
 'Item 9A1', null, 3500000, 'Environment', '{}',
 $t$$3.5 million to buy about 10 acres of South Dade wetlands for conservation$t$,
 $t$The county would acquire approximately 10 acres for the South Dade Wetlands Project under the Environmentally Endangered Lands Program, the county program that buys ecologically significant land to keep it undeveloped. The purchase price is $3.5 million, paid from Building Better Communities General Obligation Bond funds. The Nature Conservancy is involved as assignor, and the seller is the estate of Rachel M. Noto. The property is at approximately SW 344 Street and SW 169 Avenue, folio 16-7930-001-0050, and sits inside the Urban Development Boundary, the line separating where the county allows urban development from where it does not.$t$,
 $t$This is a concrete example of the county choosing conservation over development on a specific piece of land, paid for with bond money voters approved. Land inside the Urban Development Boundary is generally land that could otherwise be built on, which is part of what makes it cost what it costs. The conservation case is wetlands that hold water and habitat; the public-cost question is whether $3.5 million for about 10 acres is the right price, which turns on the appraisals behind the purchase.$t$,
 v_agenda, 'Official meeting agenda'),

-- 11 -- Other notable items -----------------------------------------------
(v_meeting, 110, 'item_code', 'Other notable items', null,
 null, null, null, null, '{}',
 $t$Other notable items$t$,
 $t$Six more items worth knowing about, summarized one by one below: a change to how the county invests its cash (Item 11A2), the annual paperwork that lets 2026 property tax bills go out (Item 11A5), up to $27 million in bonds for private educational facilities (Item 10A2), a resolution pointing the county toward vertical farming (Item 11A3), on-demand transit agreements with Doral and North Miami (Items 8N1 and 8N3), and a $17,717,216 vanpool contract (Item 8P1).$t$,
 $t$None of these will lead the news, but each one either moves real public money or sets a rule that outlasts the meeting.$t$,
 v_agenda, 'Official meeting agenda'),

-- 12 -- Investment policy --------------------------------------------------
(v_meeting, 120, 'item_code', 'Item 11A2', null,
 'Item 11A2', 'Resolution', null, 'Taxes & Budget', '{}',
 $t$A change to how the county invests its cash$t$,
 $t$The resolution would amend the county's investment policy, changing which types of investments are authorized and removing a requirement that the Board approve investments in the Local Government Surplus Funds Trust Fund, a state-run pool where Florida local governments hold short-term cash.$t$,
 $t$The county holds large cash balances between collecting revenue and spending it, and the investment policy is the rulebook for what happens to that money in the meantime. Removing a Board-approval step is a governance trade-off: it gives staff more room to move quickly, and it removes one occasion when elected officials would have had to vote in public. Which side of that trade is right is the question in front of the Board; the agenda does not settle it.$t$,
 v_agenda, 'Official meeting agenda'),

-- 13 -- Property tax administration ---------------------------------------
(v_meeting, 130, 'item_code', 'Item 11A5', null,
 'Item 11A5', 'Resolution', null, 'Taxes & Budget', '{}',
 $t$The paperwork that lets 2026 property tax bills go out$t$,
 $t$This is a tax-administration item, not a tax increase: it sets no rate and raises no rate. The resolution would extend the 2026 real and personal property tax rolls, allow tax bills to be issued before the Value Adjustment Board has finished hearing assessment appeals, and authorize the Tax Collector to conduct county business at all branch offices.$t$,
 $t$Every year, some property owners appeal their assessments to the Value Adjustment Board, and those hearings run for months. This resolution lets bills go out on schedule while appeals are still pending, which keeps county revenue arriving on time. If you have an appeal in progress, it means your bill arrives before your appeal is decided.$t$,
 v_agenda, 'Official meeting agenda'),

-- 14 -- IDA educational facility bonds ------------------------------------
(v_meeting, 140, 'item_code', 'Item 10A2', null,
 'Item 10A2', null, 27000000, 'Taxes & Budget', '{}',
 $t$Up to $27 million in bonds for educational facilities$t$,
 $t$The Miami-Dade County Industrial Development Authority is seeking Board approval to issue up to $27,000,000 in industrial development revenue bonds to finance or refinance educational facilities benefiting Chabad of Mid Miami Beach Inc., Lubavitch Educational Center Inc., and/or affiliates.$t$,
 $t$Bonds like these let a private organization borrow at tax-exempt interest rates through a public authority. The Board's approval is required for the deal to proceed, which is why a private school's financing shows up on a public agenda. Who is responsible for repaying the bonds is set out in the item's own documents, and that is the detail worth reading.$t$,
 v_agenda, 'Official meeting agenda'),

-- 15 -- Vertical farming ---------------------------------------------------
(v_meeting, 150, 'item_code', 'Item 11A3', null,
 'Item 11A3', 'Resolution', null, 'Zoning', '{}',
 $t$A push to allow vertical farming inside urban Miami-Dade$t$,
 $t$The resolution would direct the Mayor to consider recommendations from a county agriculture report and to pursue a possible amendment to the Comprehensive Development Master Plan encouraging high-intensity, closed agricultural systems (vertical farming and similar indoor growing) within urbanized areas. It directs study and a possible next step; on its own it changes no land-use rule.$t$,
 $t$Miami-Dade's farmland sits under steady development pressure, and growing food indoors in already-developed areas is one answer to that. This one is early and easy to miss, which is exactly why it is worth watching: a CDMP amendment is the step that would turn the idea into something a developer could actually build.$t$,
 v_agenda, 'Official meeting agenda'),

-- 16 -- On-demand transit --------------------------------------------------
(v_meeting, 160, 'item_code', 'Items 8N1 & 8N3', null,
 'Items 8N1, 8N3', null, null, 'Transit', '{}',
 $t$On-demand transit agreements with Doral and North Miami$t$,
 $t$Two separate on-demand transportation agreements (one with Doral, one with North Miami) for the app-hailed shuttle model that works more like a shared ride than a fixed bus route. Where applicable, the cities' share of the Charter County Transportation System Surtax helps pay for the service.$t$,
 $t$Cities and the county split transportation surtax money, and agreements like these are how a city turns its share into a service residents can actually ride. They also show the county and its municipalities trying an alternative to the fixed bus route.$t$,
 v_agenda, 'Official meeting agenda'),

-- 17 -- Vanpool -----------------------------------------------------------
(v_meeting, 170, 'item_code', 'Item 8P1', null,
 'Item 8P1', null, 17717216, 'Transit', '{}',
 $t$$17,717,216 contract for the South Florida Vanpool Program$t$,
 $t$A contract with Enterprise Leasing Company of Florida for the South Florida Vanpool Program, worth $17,717,216, with a five-year initial term and renewal options. Vanpools are shared vans organized around a regular trip, usually a longer commute.$t$,
 $t$It is a sizable regional transportation contract with one vendor over a long term. Vanpools serve commuters whose trips are hard to cover with buses or rail, particularly the ones that cross county lines.$t$,
 v_agenda, 'Official meeting agenda');

end
$seed$;
