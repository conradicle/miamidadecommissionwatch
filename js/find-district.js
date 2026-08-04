(function () {
  var DISTRICT_COLORS = [
    '#146652', '#1d3557', '#c08a2e', '#7a2d5e', '#2c4d7a',
    '#b3452c', '#1a7d64', '#8a5a1e', '#4b5563', '#0e4a3c',
    '#a5673f', '#3d6b8a', '#6b4226'
  ];

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

  document.addEventListener('DOMContentLoaded', function () {
    var mapEl = document.getElementById('district-map');
    if (!mapEl || typeof L === 'undefined') return;

    var map = L.map('district-map', { scrollWheelZoom: false }).setView([25.61, -80.55], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxZoom: 18
    }).addTo(map);

    var geojsonLayer = null;
    var resultMarker = null;
    var geojsonData = null;

    var statusEl = document.getElementById('district-search-status');
    var form = document.getElementById('district-search-form');
    var input = document.getElementById('district-search-input');

    fetch('assets/data/commission-districts.geojson')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        geojsonData = data;
        geojsonLayer = L.geoJSON(data, {
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

      var url = '/api/geocode?address=' + encodeURIComponent(address + ', Miami-Dade County, FL');

      fetch(url)
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var matches = data && data.result && data.result.addressMatches;
          if (!matches || matches.length === 0) {
            statusEl.textContent = "Couldn't find that address. Try including the city and zip code, e.g. \"111 NW 1st St, Miami, FL 33128\".";
            statusEl.className = 'district-status error';
            return;
          }

          var coords = matches[0].coordinates;
          var lng = coords.x, lat = coords.y;

          if (!geojsonData) {
            statusEl.textContent = 'District data is still loading. Try again in a moment.';
            statusEl.className = 'district-status error';
            return;
          }

          var match = findDistrictForPoint(lng, lat, geojsonData);

          if (resultMarker) map.removeLayer(resultMarker);
          resultMarker = L.marker([lat, lng]).addTo(map);
          map.setView([lat, lng], 13);

          if (!match) {
            statusEl.textContent = 'That address doesn\'t appear to fall within a Miami-Dade commission district. It may be outside county boundaries.';
            statusEl.className = 'district-status error';
            resultMarker.bindPopup(matches[0].matchedAddress).openPopup();
            return;
          }

          var d = match.properties.district;
          var name = match.properties.name;
          statusEl.innerHTML = 'You\'re in <strong>District ' + d + '</strong>, represented by <strong>' + name +
            '</strong>. <a href="' + officialProfileUrl(d) + '" target="_blank" rel="noopener">Official profile &#8599;</a>';
          statusEl.className = 'district-status success';
          resultMarker.bindPopup('District ' + d + ' &mdash; ' + name).openPopup();
        })
        .catch(function () {
          statusEl.textContent = 'Something went wrong looking up that address. Please try again.';
          statusEl.className = 'district-status error';
        });
    });
  });
})();
