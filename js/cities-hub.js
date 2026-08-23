// Renders the city cards on /cities/ from the registry in js/cities-data.js.
// The hub page itself carries the static intro and calls-to-action; only the
// card grid is data-driven, so adding a city to the registry is enough to put
// it on this page.
(function () {
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function statusBadge(status) {
    var meta = MDCW_CITY_STATUS[status] || MDCW_CITY_STATUS['team-needed'];
    return '<span class="city-status ' + meta.className + '">' + escapeHtml(meta.label) + '</span>';
  }

  function renderCard(city) {
    var inner =
      '<h3>' + escapeHtml(city.name) + '</h3>' +
      statusBadge(city.status) +
      '<p>' + escapeHtml(city.blurb) + '</p>';

    var card;
    if (city.hasPage) {
      card = document.createElement('a');
      card.href = '/cities/' + encodeURIComponent(city.slug);
      inner += '<p class="city-card-cta">Visit the ' + escapeHtml(city.name) + ' page &#8594;</p>';
    } else {
      card = document.createElement('div');
      inner += '<p class="city-card-cta"><a href="/contact.html">Interested in starting this team? Get in touch &#8594;</a></p>';
    }
    card.className = 'card city-card';
    card.innerHTML = inner;
    return card;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var grid = document.getElementById('cities-grid');
    if (!grid || typeof MDCW_CITIES === 'undefined') return;
    MDCW_CITIES.forEach(function (city) {
      grid.appendChild(renderCard(city));
    });
  });
})();
