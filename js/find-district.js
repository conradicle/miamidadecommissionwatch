// District lookup: address -> commission district.
//
// Split into two halves. The bottom half is the Leaflet map on Get Involved,
// which only initialises when #district-map and Leaflet are both present. The
// top half is a map-free core exposed as window.MDCW.districts, so the
// homepage finder can do the same lookup without pulling in a tile layer --
// there is one geocoder and one point-in-polygon implementation on the site,
// not two that can drift apart.
(function () {
  var DISTRICT_COLORS = [
    '#146652', '#1d3557', '#c08a2e', '#7a2d5e', '#2c4d7a',
    '#b3452c', '#1a7d64', '#8a5a1e', '#4b5563', '#0e4a3c',
    '#a5673f', '#3d6b8a', '#6b4226'
  ];

  // Root-absolute: this file is loaded from pages at / and from pages nested
  // under /cities/, and a relative path would resolve against the wrong base.
  var GEOJSON_URL = '/assets/data/commission-districts.geojson';

  function colorForDistrict(n) {
    return DISTRICT_COLORS[(n - 1) % DISTRICT_COLORS.length];
  }

  function officialProfileUrl(district) {
    var padded = district < 10 ? '0' + district : '' + district;
    return 'https://www.miamidade.gov/global/government/commission/district' + padded + '/home.page';
  }

  // Point-in-polygon via ray casting. Handles a single ring of [lng, lat] pairs.
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

  // A GeoJSON Polygon's coordinates are [outerRing, hole1, hole2, ...].
  function pointInPolygonCoords(lng, lat, polygonCoords) {
    if (!pointInRing(lng, lat, polygonCoords[0])) return false;
    for (var i = 1; i < polygonCoords.length; i++) {
      if (pointInRing(lng, lat, polygonCoords[i])) return false;
    }
    return true;
  }

  function pointInFeature(lng, lat, feature) {
    var geom = feature.geometry;
    if (geom.type === 'Polygon') {
      return pointInPolygonCoords(lng, lat, geom.coordinates);
    }
    if (geom.type === 'MultiPolygon') {
      for (var i = 0; i < geom.coordinates.length; i++) {
        if (pointInPolygonCoords(lng, lat, geom.coordinates[i])) return true;
      }
      return false;
    }
    return false;
  }

  function findDistrictForPoint(lng, lat, geojson) {
    for (var i = 0; i < geojson.features.length; i++) {
      if (pointInFeature(lng, lat, geojson.features[i])) {
        return geojson.features[i];
      }
    }
    return null;
  }

  // Boundary data is a few hundred KB, so fetch it once per page load and
  // hand every caller the same promise.
  var boundaryPromise = null;
  function loadBoundaries() {
    if (!boundaryPromise) {
      boundaryPromise = fetch(GEOJSON_URL).then(function (res) {
        if (!res.ok) throw new Error('boundary fetch failed');
        return res.json();
      });
    }
    return boundaryPromise;
  }

  // Errors are returned as a { error: code } result rather than thrown, so
  // callers can map each case to its own wording without string-matching.
  function lookup(address) {
    var url = '/api/geocode?address=' + encodeURIComponent(address + ', Miami-Dade County, FL');

    return Promise.all([
      fetch(url).then(function (res) { return res.json(); }),
      loadBoundaries()
    ]).then(function (results) {
      var data = results[0];
      var geojson = results[1];

      var matches = data && data.result && data.result.addressMatches;
      if (!matches || matches.length === 0) {
        return { error: 'no-address' };
      }

      var coords = matches[0].coordinates;
      var lng = coords.x, lat = coords.y;
      var match = findDistrictForPoint(lng, lat, geojson);

      if (!match) {
        return { error: 'outside-county', lat: lat, lng: lng, matchedAddress: matches[0].matchedAddress };
      }

      return {
        district: match.properties.district,
        name: match.properties.name,
        lat: lat,
        lng: lng,
        matchedAddress: matches[0].matchedAddress
      };
    }).catch(function () {
      return { error: 'failed' };
    });
  }

  window.MDCW = window.MDCW || {};
  window.MDCW.districts = {
    lookup: lookup,
    loadBoundaries: loadBoundaries,
    colorForDistrict: colorForDistrict,
    officialProfileUrl: officialProfileUrl
  };

  // ---------------------------------------------------------------------
  // Get Involved map. Everything below is optional decoration on top of the
  // core above -- pages without #district-map or without Leaflet just skip it.
  // ---------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    var mapEl = document.getElementById('district-map');
    if (!mapEl || typeof L === 'undefined') return;

    var map = L.map('district-map', { scrollWheelZoom: false }).setView([25.61, -80.55], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxZoom: 18
    }).addTo(map);

    var resultMarker = null;

    var statusEl = document.getElementById('district-search-status');
    var form = document.getElementById('district-search-form');
    var input = document.getElementById('district-search-input');

    loadBoundaries()
      .then(function (data) {
        L.geoJSON(data, {
          style: function (feature) {
            return {
              color: colorForDistrict(feature.properties.district),
              weight: 2,
              fillColor: colorForDistrict(feature.properties.district),
              fillOpacity: 0.25
            };
          },
          onEachFeature: function (feature, layer) {
            var d = feature.properties.district;
            var name = feature.properties.name;
            layer.bindPopup(
              '<strong>District ' + d + '</strong><br>' + name +
              '<br><a href="' + officialProfileUrl(d) + '" target="_blank" rel="noopener">Official profile &#8599;</a>'
            );
          }
        }).addTo(map);
      })
      .catch(function () {
        if (statusEl) {
          statusEl.textContent = 'Could not load district boundary data. Try refreshing the page.';
          statusEl.className = 'district-status error';
        }
      });

    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var address = input.value.trim();
      if (!address) return;

      statusEl.textContent = 'Looking up that address...';
      statusEl.className = 'district-status';

      lookup(address).then(function (result) {
        if (result.error === 'no-address') {
          statusEl.textContent = "Couldn't find that address. Try including the city and zip code, e.g. \"111 NW 1st St, Miami, FL 33128\".";
          statusEl.className = 'district-status error';
          return;
        }
        if (result.error === 'failed') {
          statusEl.textContent = 'Something went wrong looking up that address. Please try again.';
          statusEl.className = 'district-status error';
          return;
        }

        if (resultMarker) map.removeLayer(resultMarker);
        resultMarker = L.marker([result.lat, result.lng]).addTo(map);
        map.setView([result.lat, result.lng], 13);

        if (result.error === 'outside-county') {
          statusEl.textContent = 'That address doesn\'t appear to fall within a Miami-Dade commission district. It may be outside county boundaries.';
          statusEl.className = 'district-status error';
          resultMarker.bindPopup(result.matchedAddress).openPopup();
          return;
        }

        statusEl.innerHTML = 'You\'re in <strong>District ' + result.district + '</strong>, represented by <strong>' + result.name +
          '</strong>. <a href="' + officialProfileUrl(result.district) + '" target="_blank" rel="noopener">Official profile &#8599;</a>';
        statusEl.className = 'district-status success';
        resultMarker.bindPopup('District ' + result.district + ': ' + result.name).openPopup();
      });
    });
  });
})();
