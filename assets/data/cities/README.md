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
| `miamibeach.geojson` | Miami-Dade County GIS Open Data, "Municipal Boundary" layer (gis-mdc.opendata.arcgis.com), the main `NAME = 'MIAMI BEACH'` feature only (OBJECTID 57) | 2026-10-26 |

`miamibeach.geojson` is the city limits as the county draws them: one
Polygon with no holes, from South Pointe and Government Cut north to the
Surfside line, taking in the bay islands and the bay water inside the
corporate limits. 890 points, 20 KB.

The layer has a second feature named `MIAMI BEACH` (OBJECTID 1, about 0.3%
of the area): a block on **Fisher Island** with 12 holes, each matching a
small `UNINCORPORATED MIAMI-DADE` parcel. Fisher Island is unincorporated, and
merging that feature in made the map outline a patch of Fisher Island in
parcel-shaped pieces (October 2026). Leave it out.

### Refreshing a city limits file

The layer is served at
`https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/Municipalitypoly_gdb/FeatureServer/0`.

1. Download the whole layer as WGS84 GeoJSON:
   `<layer url>/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`
2. List the features whose `NAME` is the city (uppercase, e.g. `MIAMI BEACH`)
   with their bounding boxes and `Shape__Area` before merging anything. A
   city can have more than one feature, and not every one is real city
   territory (see the Fisher Island note above). Keep the ones that are, as a
   single Feature with `name`, `source` and `retrieved` properties.
3. Simplify and round with mapshaper:
   `npx mapshaper in.geojson -simplify 50% keep-shapes -o out.geojson precision=0.000001`
   For Miami Beach that takes 1,777 points down to 890 / 20 KB.
4. Check a handful of known addresses inside and just outside the city, then
   update the table above.

## Placeholders

`_placeholder.geojson` is a valid, deliberately empty FeatureCollection. It
exists so the loading path can be exercised before any real boundary has been
sourced. It is not a stand-in for a real boundary and must never be renamed to
a city slug.
