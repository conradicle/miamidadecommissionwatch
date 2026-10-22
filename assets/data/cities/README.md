# City boundary data

One GeoJSON file per city, named by its subdomain slug:

    assets/data/cities/<slug>.geojson      e.g. miamibeach.geojson

## The two shapes a file can take

Which one a city needs is decided by its `governance` field, not by what data
happens to exist:

**`district` cities** — one Feature per council/commission district. Each
Feature needs these properties, because `js/city-site.js` reads them by name:

```json
{ "type": "Feature",
  "properties": { "district": 3, "name": "District 3" },
  "geometry": { "type": "Polygon", "coordinates": [ ... ] } }
```

`district` must be a number. `name` is what the popup and the address-lookup
result show.

**`at-large` cities** — a single Feature holding the city limits outline, with
no `district` property. Miami Beach is at-large: the Mayor and all six
Commissioners are elected citywide, so the map shows only the city boundary
and the address check answers just "inside the city limits or not".

Do not split an at-large city into invented districts to make the map look
busier. An at-large city with fake districts is worse than no map.

## Sourcing

**Every city has to be sourced individually. There is no countywide file that
contains municipal council districts.** The county's own
`assets/data/commission-districts.geojson` covers the 13 *county* commission
districts only and is unrelated to any city council.

Usual places to look, in rough order of likelihood:

1. The city's own open-data portal or GIS department.
2. Miami-Dade County GIS Open Data, which publishes municipal boundaries (city
   limits) even where it does not publish council districts.
3. The city clerk, by public-records request, when the charter defines
   districts but nothing is published.

**Some cities do not publish their boundaries in any machine-readable form.**
That is an expected outcome, not a failure. When it happens, leave the city
without a GeoJSON file — the map section degrades to an honest empty state —
and record what you tried, so the next person doesn't repeat it.

Shapefiles are the common download format and need converting to GeoJSON in
WGS84 (EPSG:4326). Check the coordinate order after converting: GeoJSON is
`[longitude, latitude]`, and a file that plots in the Indian Ocean has them
swapped. Simplify aggressively before committing — an unsimplified city
boundary can run to several megabytes, and this site loads it over the wire on
a phone.

## Files in this directory

| File | Source | Retrieved |
| --- | --- | --- |
| `miamibeach.geojson` | Miami-Dade County GIS Open Data, "Municipal Boundary" layer (gis-mdc.opendata.arcgis.com), features where `NAME = 'MIAMI BEACH'` | 2026-10-21 |

`miamibeach.geojson` is the city limits as the county draws them: one
MultiPolygon, the main outline (with 12 holes for the other jurisdictions it
surrounds, such as Indian Creek Village) plus one detached piece. Keep the
holes when refreshing it: the address check treats a point inside a hole as
outside the city.

### Refreshing a city limits file

The layer is served at
`https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/Municipalitypoly_gdb/FeatureServer/0`.

1. Download the whole layer as WGS84 GeoJSON:
   `<layer url>/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`
2. Keep the features whose `NAME` is the city (uppercase, e.g. `MIAMI BEACH`;
   a city can have more than one feature) and merge them into a single
   MultiPolygon Feature with `name`, `source` and `retrieved` properties.
3. Simplify and round with mapshaper:
   `npx mapshaper in.geojson -simplify 50% keep-shapes -o out.geojson precision=0.000001`
   For Miami Beach that takes 2,359 points / 87 KB down to 1,194 points /
   27 KB with every island and hole intact.
4. Update the table above.

## Placeholders

`_placeholder.geojson` is a valid, deliberately empty FeatureCollection. It
exists so the loading path can be exercised before any real boundary has been
sourced. It is not a stand-in for a real boundary and must never be renamed to
a city slug.
