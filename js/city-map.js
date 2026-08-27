// The city map, in two modes.
//
// Which mode runs is decided by the city's `governance` field, and the whole
// reason that field exists is this file:
//
//   'district'  boundary polygons plus an address lookup that answers
//               "you are in District 3, your commissioner is X"
//   'at-large'  the city limits outline only, plus copy explaining that every
//               resident is represented by every commissioner
//
// An at-large city gets NO address form and NO districts, because it has none.
// Drawing invented districts on a city that elects citywide would be a factual
// error rendered as a picture, which is worse than showing nothing.
//
// Boundaries come from assets/data/cities/<slug>.geojson. Most cities will not
// have one for a while -- see the README in that directory -- so a missing
// file is an expected state, not an error, and the section degrades to a line
// of text.
//
// Same library and visual language as the county district finder in
// js/find-district.js: Leaflet, OpenStreetMap tiles, the Census geocoder
// proxied through /api/geocode, and point-in-polygon done here rather than
// with a geometry dependency.
(function () {
  var DISTRICT_COLORS = [
    '#146652', '#1d3557', '#c08a2e', '#7a2d5e', '#2c4d7a',
    '#b3452c', '#1a7d64', '#8a5a1e', '#4b5563', '#0e4a3c',
    '#a5673f', '#3d6b8a', '#6b4226'
  ];

  function colorForDistrict(n) {
    var i = parseInt(n, 10);
    if (isNaN(i)) return DISTRICT_COLORS[0];
    return DISTRICT_COLORS[(i - 1 + DISTRICT_COLORS.length) % DISTRICT_COLORS.length];
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function el(id) { return document.getElementById(id); }

  // ---------- point in polygon ----------
  // Ray casting over a single ring of [lng, lat] pairs.
  function pointInRing(lng, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1];
      var xj = ring[j][0], yj = ring[j][1];
      var intersect = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // A GeoJSON Polygon's coordinates are [outerRing, hole1, hole2, ...]. A
  // point inside a hole is outside the polygon.
  function pointInPolygonCoords(lng, lat, coords) {
    if (!pointInRing(lng, lat, coords[0])) return false;
    for (var i = 1; i < coords.length; i++) {
      if (pointInRing(lng, lat, coords[i])) return false;
    }
    return true;
  }

  function pointInFeature(lng, lat, feature) {
    var geom = feature && feature.geometry;
    if (!geom) return false;
    if (geom.type === 'Polygon') return pointInPolygonCoords(lng, lat, geom.coordinates);
    if (geom.type === 'MultiPolygon') {
      for (var i = 0; i < geom.coordinates.length; i++) {
        if (pointInPolygonCoords(lng, lat, geom.coordinates[i])) return true;
      }
      return false;
    }
    return false;
  }

  function findFeatureForPoint(lng, lat, geojson) {
    var features = (geojson && geojson.features) || [];
    for (var i = 0; i < features.length; i++) {
      if (pointInFeature(lng, lat, features[i])) return features[i];
    }
    return null;
  }

  // ---------- officials lookup ----------
  // Who represents district N, if anybody has been recorded yet.
  function officialForDistrict(officials, district) {
    var d = parseInt(district, 10);
    for (var i = 0; i < officials.length; i++) {
      if (officials[i].seat_type === 'district' && parseInt(officials[i].district, 10) === d) {
        return officials[i];
      }
    }
    return null;
  }

  function representativeLine(officials, district) {
    var official = officialForDistrict(officials, district);
    if (!official) {
      return 'No commissioner has been recorded for this district yet.';
    }
    var line = 'Your commissioner is <strong>' + escapeHtml(official.name) + '</strong>';
    if (official.contact_email) {
      line += ' (<a href="mailto:' + escapeHtml(official.contact_email) + '">' +
        escapeHtml(official.contact_email) + '</a>)';
    }
    return line + '.';
  }

  // ---------- rendering ----------
  function setStatus(message, kind) {
    var node = el('city-district-status');
    if (!node) return;
    node.innerHTML = message || '';
    node.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  function showEmpty(message) {
    var mount = el('city-map-mount');
    if (mount) {
      mount.innerHTML = '<p style="color:var(--ink-400); font-style:italic;">' +
        escapeHtml(message) + '</p>';
    }
  }

  function buildMap() {
    var node = el('city-map');
    node.style.display = '';
    var map = L.map('city-map', { scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxZoom: 18
    }).addTo(map);
    return map;
  }

  // ---------- the two modes ----------
  function renderAtLarge(map, geojson, city) {
    var layer = L.geoJSON(geojson, {
      style: function () {
        return { color: '#146652', weight: 2, fillColor: '#146652', fillOpacity: 0.12 };
      }
    }).addTo(map);

    try { map.fitBounds(layer.getBounds(), { padding: [20, 20] }); }
    catch (e) { map.setView([25.79, -80.21], 12); }

    layer.bindPopup('<strong>' + escapeHtml(city.name) + '</strong><br>' +
      'Every commissioner is elected citywide.');
  }

  function renderDistricts(map, geojson, city, officials) {
    var layer = L.geoJSON(geojson, {
      style: function (feature) {
        var d = feature.properties && feature.properties.district;
        return {
          color: colorForDistrict(d),
          weight: 2,
          fillColor: colorForDistrict(d),
          fillOpacity: 0.25
        };
      },
      onEachFeature: function (feature, lyr) {
        var props = feature.properties || {};
        var d = props.district;
        var label = props.name || (d != null ? 'District ' + d : 'District');
        var official = officialForDistrict(officials, d);
        lyr.bindPopup('<strong>' + escapeHtml(label) + '</strong>' +
          (official ? '<br>' + escapeHtml(official.name) : '<br>No commissioner recorded yet.'));
      }
    }).addTo(map);

    try { map.fitBounds(layer.getBounds(), { padding: [20, 20] }); }
    catch (e) { map.setView([25.79, -80.21], 12); }

    wireAddressLookup(map, geojson, city, officials);
  }

  function wireAddressLookup(map, geojson, city, officials) {
    var form = el('city-district-form');
    var input = el('city-district-input');
    if (!form || !input) return;

    form.style.display = '';
    var marker = null;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var address = input.value.trim();
      if (!address) return;

      setStatus('Looking up that address…');

      // The city name is appended so a bare street address resolves inside
      // the right municipality rather than a same-named street elsewhere.
      var query = address + ', ' + city.name + ', FL';

      fetch('/api/geocode?address=' + encodeURIComponent(query))
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var matches = data && data.result && data.result.addressMatches;
          if (!matches || !matches.length) {
            setStatus('Couldn’t find that address. Try including the street number and zip code.', 'error');
            return;
          }

          var coords = matches[0].coordinates;
          var lng = coords.x, lat = coords.y;

          if (marker) map.removeLayer(marker);
          marker = L.marker([lat, lng]).addTo(map);
          map.setView([lat, lng], 14);

          var match = findFeatureForPoint(lng, lat, geojson);
          if (!match) {
            setStatus('That address doesn’t appear to fall inside ' + escapeHtml(city.name) +
              '. It may be outside the city limits.', 'error');
            marker.bindPopup(escapeHtml(matches[0].matchedAddress)).openPopup();
            return;
          }

          var d = (match.properties || {}).district;
          setStatus('You’re in <strong>District ' + escapeHtml(String(d)) + '</strong>. ' +
            representativeLine(officials, d), 'success');
          marker.bindPopup('District ' + escapeHtml(String(d))).openPopup();
        })
        .catch(function () {
          setStatus('Something went wrong looking up that address. Please try again.', 'error');
        });
    });
  }

  // ---------- entry point ----------
  // Called by js/city-site.js once the city and its officials have loaded,
  // because both modes need to know which city this is and district mode needs
  // the roster to name a commissioner.
  window.initCityMap = function (city, officials) {
    if (typeof L === 'undefined' || !el('city-map')) return;
    officials = officials || [];

    // A boundary uploaded by the city team wins over one committed to the
    // repo: the team is closer to the source, and it means they can fix their
    // own map without waiting for a deploy.
    var fromDatabase = city.boundary_geojson;
    var source = fromDatabase
      ? Promise.resolve(fromDatabase)
      : fetch('/assets/data/cities/' + encodeURIComponent(city.slug) + '.geojson')
          .then(function (res) {
            if (!res.ok) throw new Error('no boundary file');
            return res.json();
          });

    source
      .then(function (geojson) {
        if (!geojson || !geojson.features || !geojson.features.length) {
          throw new Error('empty boundary file');
        }
        var map = buildMap();
        if (city.governance === 'at-large') {
          renderAtLarge(map, geojson, city);
        } else {
          renderDistricts(map, geojson, city, officials);
        }
      })
      .catch(function () {
        // Expected for most cities: nobody has sourced the boundary yet. Say
        // so plainly rather than showing a broken map frame.
        showEmpty(city.governance === 'at-large'
          ? 'The city boundary outline hasn’t been added yet.'
          : 'District boundaries for ' + city.name + ' haven’t been added yet.');
      });
  };
})();
