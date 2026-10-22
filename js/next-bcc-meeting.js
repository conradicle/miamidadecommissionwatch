// The next BCC meeting students can sign up for, shared by /attend
// (js/attend.js) and the homepage's "Attend with us" section (js/home.js).
//
// One query: next_bcc_meeting() from migration_29, which returns the earliest
// meeting that is open and still taking sign-ups, and no row at all once the
// Saturday cutoff has passed or when staff haven't opened one. So "closed" and
// "nothing scheduled" look the same from here, on purpose.
//
// load() resolves, never rejects, to one of:
//   { status: 'open', meeting: { meeting_date, title, location, start_time, ... } }
//   { status: 'closed' }
//   { status: 'error' }
(function () {
  function load() {
    if (typeof supabaseClient === 'undefined' || !supabaseClient) {
      return Promise.resolve({ status: 'error' });
    }
    return Promise.resolve(supabaseClient.rpc('next_bcc_meeting')).then(function (res) {
      if (res.error) return { status: 'error' };
      var meeting = res.data && res.data[0];
      return meeting ? { status: 'open', meeting: meeting } : { status: 'closed' };
    }, function () { return { status: 'error' }; });
  }

  // "2026-11-17" -> "Tuesday, November 17, 2026". Built from the parts so the
  // browser's own timezone can't shift it a day.
  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return iso || '';
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  // "09:30:00" -> "9:30 AM". bcc_meetings.start_time defaults to 09:30.
  function formatTime(t) {
    var m = /^(\d{1,2}):(\d{2})/.exec(t || '');
    if (!m) return '9:30 AM';
    var h = Number(m[1]);
    return (((h + 11) % 12) + 1) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  // When sign-ups close, as "Saturday, November 14". Uses signup_closes_at
  // when the RPC returns it (migration_30, so a close time staff moved in the
  // dashboard shows correctly); otherwise the default the migration_29
  // trigger fills in, the Saturday strictly before the meeting
  // (bcc_default_signup_close).
  function formatCloses(meeting) {
    if (meeting.signup_closes_at) {
      return new Date(meeting.signup_closes_at).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York'
      });
    }
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(meeting.meeting_date || '');
    if (!m) return '';
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var isodow = d.getDay() || 7;
    d.setDate(d.getDate() - ((isodow % 7) + 1));
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  window.MDCW = window.MDCW || {};
  window.MDCW.nextBcc = {
    load: load,
    formatDate: formatDate,
    formatTime: formatTime,
    formatCloses: formatCloses
  };
})();
