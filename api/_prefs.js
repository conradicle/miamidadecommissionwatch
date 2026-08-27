// Shared subscription-preference parsing and matching.
//
// Underscore-prefixed, so Vercel treats it as a module rather than a route.
// Required by newsletter-subscribe.js, newsletter-preferences.js and
// notify-subscribers.js, which all need the same vocabulary -- three copies of
// this list would drift, and a drifted topic list means someone silently stops
// receiving the mail they asked for.

// Must stay in sync with public.mdcw_topics() in
// supabase/migration_14_structured_items_votes_alerts.sql and with TOPICS in
// js/meetings-feed.js.
var TOPICS = [
  'Housing',
  'Transit',
  'Zoning',
  'Public Safety',
  'Taxes & Budget',
  'Environment',
  'Parks',
  'Other'
];

var DISTRICTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

// Returns { provided, values } on success or { error } on bad input.
// `provided` is false when the caller sent no preference fields at all, which
// is how the plain homepage signup form behaves -- that must keep meaning
// "everything", not "nothing".
function parsePreferences(body) {
  if (!body || typeof body !== 'object') return { provided: false, values: {} };

  var hasDistricts = Object.prototype.hasOwnProperty.call(body, 'districts');
  var hasTopics = Object.prototype.hasOwnProperty.call(body, 'topics');
  var hasAll = Object.prototype.hasOwnProperty.call(body, 'all_meetings');

  if (!hasDistricts && !hasTopics && !hasAll) {
    return { provided: false, values: {} };
  }

  var districts = [];
  if (hasDistricts) {
    if (!Array.isArray(body.districts)) {
      return { error: 'districts must be a list' };
    }
    if (body.districts.length > DISTRICTS.length) {
      return { error: 'Too many districts selected' };
    }
    for (var i = 0; i < body.districts.length; i++) {
      var d = Number(body.districts[i]);
      if (DISTRICTS.indexOf(d) === -1) {
        return { error: 'District ' + body.districts[i] + ' is not a Miami-Dade commission district' };
      }
      if (districts.indexOf(d) === -1) districts.push(d);
    }
  }

  var topics = [];
  if (hasTopics) {
    if (!Array.isArray(body.topics)) {
      return { error: 'topics must be a list' };
    }
    if (body.topics.length > TOPICS.length) {
      return { error: 'Too many topics selected' };
    }
    for (var j = 0; j < body.topics.length; j++) {
      var t = body.topics[j];
      if (TOPICS.indexOf(t) === -1) {
        return { error: 'Unknown topic: ' + String(t).slice(0, 40) };
      }
      if (topics.indexOf(t) === -1) topics.push(t);
    }
  }

  // Selecting nothing at all is the same as wanting everything. Someone who
  // ticks no boxes has not asked to be cut off from the digest.
  var allMeetings = hasAll
    ? body.all_meetings !== false
    : (districts.length === 0 && topics.length === 0);

  return {
    provided: true,
    values: {
      all_meetings: allMeetings,
      districts: districts,
      topics: topics
    }
  };
}

// Does this subscriber want mail about this meeting?
//
// all_meetings wins outright. Otherwise at least one item on the meeting has
// to match one of their districts or one of their topics. A countywide item
// (empty districts array) counts as matching every district they picked --
// "$2.5B of borrowing for the whole county" is not less relevant to District 5
// than a District 5 zoning change.
function meetingMatchesSubscriber(meeting, subscriber) {
  if (!subscriber || subscriber.all_meetings !== false) return true;

  var districts = Array.isArray(subscriber.districts) ? subscriber.districts : [];
  var topics = Array.isArray(subscriber.topics) ? subscriber.topics : [];

  if (!districts.length && !topics.length) return true;

  var items = (meeting && meeting.meeting_items) || [];

  for (var i = 0; i < items.length; i++) {
    var item = items[i];

    if (topics.length && item.topic && topics.indexOf(item.topic) !== -1) return true;

    if (districts.length) {
      var itemDistricts = Array.isArray(item.districts) ? item.districts : [];
      if (itemDistricts.length === 0) return true; // countywide
      for (var j = 0; j < itemDistricts.length; j++) {
        if (districts.indexOf(Number(itemDistricts[j])) !== -1) return true;
      }
    }
  }

  return false;
}

module.exports = {
  TOPICS: TOPICS,
  DISTRICTS: DISTRICTS,
  parsePreferences: parsePreferences,
  meetingMatchesSubscriber: meetingMatchesSubscriber
};
