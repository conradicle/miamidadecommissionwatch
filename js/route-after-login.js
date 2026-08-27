// Decides where a signed-in account belongs, and sends it there.
//
// Two dashboards exist now and they are deliberately separate pages: staff get
// admin.html (county editorial queue, newsletter, claims, every city), a city
// team gets city-admin.html (their own city and nothing else). Before this,
// every login went to admin.html, which for a student would have been a page
// full of controls their RLS policies then refused.
//
// A site-wide staff role wins over a city membership, because staff who also
// own a city still want the full dashboard -- they can reach the city from
// there anyway.
//
// This decides only WHERE TO SEND SOMEBODY. It is not access control: both
// dashboards check for themselves, and every query behind them runs under Row
// Level Security. Landing on the wrong page shows an empty one, not somebody
// else's data.
(function () {
  window.routeAfterLogin = function (fallbackStatusEl) {
    return window.supabaseClient.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      if (!session) return false;

      return window.supabaseClient
        .from('user_roles')
        .select('role, status')
        .eq('user_id', session.user.id)
        .maybeSingle()
        .then(function (roleRes) {
          var row = roleRes && roleRes.data;
          var isStaff = row && row.status === 'active' &&
            (row.role === 'owner' || row.role === 'admin');

          if (isStaff) {
            window.location.href = 'admin.html';
            return true;
          }

          return window.supabaseClient
            .from('city_memberships')
            .select('city_id')
            .eq('user_id', session.user.id)
            .limit(1)
            .then(function (memberRes) {
              if (memberRes.data && memberRes.data.length) {
                window.location.href = 'city-admin.html';
                return true;
              }

              // Signed in, but on nothing. Says so rather than bouncing them
              // between two dashboards that both look broken.
              if (fallbackStatusEl) {
                fallbackStatusEl.textContent =
                  'You’re signed in, but this account isn’t on a city team or the staff list yet. ' +
                  'If you were expecting access, ask whoever invited you.';
                fallbackStatusEl.className = 'district-status error';
              }
              return false;
            });
        });
    });
  };
})();
