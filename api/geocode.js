// Proxies address lookups to the Census Bureau geocoder, which does not send
// CORS headers and so cannot be called directly from browser JS.
module.exports = async function handler(req, res) {
  var address = req.query.address;
  if (!address || typeof address !== 'string') {
    res.status(400).json({ error: 'Missing address parameter' });
    return;
  }

  var url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress' +
    '?address=' + encodeURIComponent(address) +
    '&benchmark=Public_AR_Current&format=json';

  try {
    var censusRes = await fetch(url);
    var data = await censusRes.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach Census geocoding service' });
  }
};
