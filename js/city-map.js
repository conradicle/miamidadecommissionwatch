// The city map, in two modes.
//
// Which mode runs is decided by the city's `governance` field, and the whole
// reason that field exists is this file:
//
//   'district'  boundary polygons plus an address lookup that answers
//               "you are in District 3, your commissioner is X"
//   'at-large'  the city limits outline only, plus an address check that
//               answers "you're in the city, every official represents you"
//
// An at-large city gets NO districts, because it has none. Drawing invented
// districts on a city that elects citywide would be a factual error rendered
// as a picture, which is worse than showing nothing. Its address check only
// asks "inside the city limits or not".
//
// Boundaries come from assets/data/cities/<slug>.geojson. Most cities will not
// have one for a while -- see the README in that directory -- so a missing
// file is an expected state, not an error, and the section degrades to its
// explanatory text. The map and the address form only appear once a boundary
// has actually loaded, so a failure never leaves an empty gray box.
//
// Same library and visual language as the county district finder in
// js/find-district.js: Leaflet, OpenStreetMap tiles, the Census geocoder
// proxied through /api/geocode, and point-in-polygon done here rather than
// with a geometry dependency.
(function () {
  // MDCW navy, the at-large outline.
  var CITY_COLOR = '#1B365D';

  // No red and green in the same palette: they collapse into one muddy tone
  // for red-green colorblind readers, and neighboring districts would read as
  // one. Navy, gold, blues, plum and slate stay apart, and every district is
  // named in its popup, so color is never the only cue.
  var DISTRICT_COLORS = [
    '#1B365D', '#E69F00', '#56B4E9', '#7a2d5e',
    '#4b5563', '#0072B2', '#CC79A7', '#85670F'
  ];

  var NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six',
    'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

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

  // "All seven officials represent you", counted from the roster rather than
  // assumed, so a vacancy or an extra seat never makes the sentence wrong.
  function everyoneLine(officials) {
    var n = officials.length;
    var text = n
      ? 'All ' + (NUMBER_WORDS[n] || n) + ' official' + (n === 1 ? '' : 's') + ' represent you.'
      : 'Every member of the commission represents you.';
    return '<a href="#officials">' + text + '</a>';
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

  function hideMap(map) {
    if (map) map.remove();
    var node = el('city-map');
    if (node) node.style.display = 'none';
    var form = el('city-district-form');
    if (form) form.style.display = 'none';
  }

  function buildMap() {
    var node = el('city-map');
    node.style.display = '';

    // The map ignores the scroll wheel, and on phones one-finger drags, until
    // it is clicked or tapped. Otherwise a reader scrolling past the section
    // gets caught zooming or panning the map instead of the page.
    // L.Browser.mobile, not .touch: .touch is true on any desktop browser
    // with pointer events. And a native listener, not map.on('click'): a
    // click on the outline opens its popup, and Leaflet stops that click
    // before the map ever hears it.
    var phone = !!L.Browser.mobile;
    var map = L.map('city-map', { scrollWheelZoom: false, dragging: !phone });
    node.addEventListener('click', function () {
      map.scrollWheelZoom.enable();
      if (phone) map.dragging.enable();
    }, { once: true });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxZoom: 18
    }).addTo(map);
    return map;
  }

  // ---------- address lookup ----------
  // A bare street address gets the city appended so it resolves inside the
  // right municipality rather than a same-named street elsewhere. An address
  // that already names a place is sent as typed: appending this city to
  // "111 NW 1st St, Miami" would steer the geocoder into this city and turn an
  // outside address into a false "you're inside".
  function geocodeQuery(address, city) {
    if (address.indexOf(',') === -1) return address + ', ' + city.name + ', FL';
    return /\b(FL|Florida)\b/i.test(address) ? address : address + ', FL';
  }

  // Wires the address form to `onPoint(lng, lat, matchedAddress, marker)`,
  // which turns a geocoded point into a status line and a marker popup for
  // the current mode. It may return bounds to show instead of the default
  // street-level zoom on the point; the map moves once, either way, because
  // two animated moves back to back cancel each other out.
  function wireAddressLookup(map, city, buttonLabel, onPoint) {
    var form = el('city-district-form');
    var input = el('city-district-input');
    if (!form || !input) return;

    var button = form.querySelector('button[type="submit"]');
    if (button) button.textContent = buttonLabel;
    form.style.display = '';
    var marker = null;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var address = input.value.trim();
      if (!address) return;

      setStatus('Looking up that address…');

      fetch('/api/geocode?address=' + encodeURIComponent(geocodeQuery(address, city)))
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var matches = data && data.result && data.result.addressMatches;
          if (!matches || !matches.length) {
            setStatus('Couldn’t find that address. Try including the street number and zip code.', 'outside');
            return;
          }

          var coords = matches[0].coordinates;
          var lng = coords.x, lat = coords.y;

          if (marker) map.removeLayer(marker);
          marker = L.marker([lat, lng]).addTo(map);

          var bounds = onPoint(lng, lat, matches[0].matchedAddress, marker);
          if (bounds) map.fitBounds(bounds, { padding: [30, 30] });
          else map.setView([lat, lng], 14);
          marker.openPopup();
        })
        .catch(function () {
          setStatus('Something went wrong looking up that address. Please try again.', 'outside');
        });
    });
  }

  // ---------- the two modes ----------
  function renderAtLarge(map, geojson, city, officials) {
    var layer = L.geoJSON(geojson, {
      style: function () {
        return { color: CITY_COLOR, weight: 3, fillColor: CITY_COLOR, fillOpacity: 0.08 };
      }
    }).addTo(map);

    map.fitBounds(layer.getBounds(), { padding: [20, 20] });

    layer.bindPopup('<strong>' + escapeHtml(city.name) + '</strong><br>' +
      'Every commissioner is elected citywide.');

    wireAddressLookup(map, city, 'Check your address', function (lng, lat, matched, marker) {
      marker.bindPopup(escapeHtml(matched));
      if (findFeatureForPoint(lng, lat, geojson)) {
        setStatus('You’re in ' + escapeHtml(city.name) + '. ' + everyoneLine(officials), 'inside');
        return null;
      }
      setStatus('That address is outside ' + escapeHtml(city.name) + ' city limits.', 'outside');
      // Show the address and the whole outline together, not a tight zoom on
      // a street with no boundary in view.
      return L.latLngBounds(layer.getBounds()).extend(marker.getLatLng());
    });
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

    map.fitBounds(layer.getBounds(), { padding: [20, 20] });

    wireAddressLookup(map, city, 'Find my district', function (lng, lat, matched, marker) {
      var match = findFeatureForPoint(lng, lat, geojson);
      if (!match) {
        setStatus('That address doesn’t appear to fall inside ' + escapeHtml(city.name) +
          '. It may be outside the city limits.', 'outside');
        marker.bindPopup(escapeHtml(matched));
        return null;
      }

      var d = (match.properties || {}).district;
      setStatus('You’re in <strong>District ' + escapeHtml(String(d)) + '</strong>. ' +
        representativeLine(officials, d), 'inside');
      marker.bindPopup('District ' + escapeHtml(String(d)));
      return null;
    });
  }

  // ---------- entry point ----------
  // Called by js/city-site.js once the city and its officials have loaded,
  // because both modes need to know which city this is and need the roster to
  // say who represents an address.
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
            if (res.status === 404) throw new Error('no boundary file');
            if (!res.ok) throw new Error('boundary failed to load');
            return res.json();
          });

    source
      .then(function (geojson) {
        if (!geojson || !geojson.features || !geojson.features.length) {
          throw new Error('no boundary file');
        }
        var map = buildMap();
        try {
          if (city.governance === 'at-large') {
            renderAtLarge(map, geojson, city, officials);
          } else {
            renderDistricts(map, geojson, city, officials);
          }
        } catch (e) {
          // Bad geometry: take the half-drawn map back down.
          hideMap(map);
          throw e;
        }
      })
      .catch(function (err) {
        hideMap(null);
        // The intro already explains who represents whom; only its pointer at
        // "this boundary" needs to stop pointing at a map that isn't there.
        var ref = document.querySelector('#city-map-intro .js-boundary-ref');
        if (ref) ref.textContent = 'the city limits';

        // No file at all is the expected state for most cities, so say so
        // plainly. Any other failure (network, bad JSON) gets no extra line:
        // the explanatory text stands on its own.
        if (err && err.message === 'no boundary file' && city.governance !== 'at-large') {
          showEmpty('District boundaries for ' + city.name + ' haven’t been added yet.');
        }
      });
  };
})();
