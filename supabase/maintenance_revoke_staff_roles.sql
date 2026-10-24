-- Miami-Dade Commission Watch: revoke staff access (2026-10-24).
-- Run in the Supabase SQL editor.
--
-- Sets status to 'revoked' rather than deleting the row: that is what the
-- dashboard's own Revoke button does, every staff policy already requires
-- status = 'active', and putting it back is one UPDATE.

-- Before: confirm exactly what is there.
select r.user_id, r.email, r.role, r.status, u.created_at, u.invited_at, u.last_sign_in_at
  from public.user_roles r
  join auth.users u on u.id = r.user_id
 where lower(u.email) in ('handuenas@gmail.com', 'svertexy@gmail.com');

-- handuenas@gmail.com: approved by Conrad on 2026-10-24.
update public.user_roles r
   set status = 'revoked'
  from auth.users u
 where u.id = r.user_id
   and lower(u.email) = 'handuenas@gmail.com'
returning r.user_id, r.role, r.status;

-- Their current session tokens stay valid until they expire (1 hour by
-- default), but every staff policy and api/ check reads user_roles.status on
-- each request, so the revoke bites immediately. To also end the session:
-- delete from auth.sessions where user_id = (select id from auth.users where lower(email) = 'handuenas@gmail.com');

-- svertexy@gmail.com: WAITING for Conrad's yes. Do not run until then.
-- update public.user_roles r set status = 'revoked'
--   from auth.users u
--  where u.id = r.user_id and lower(u.email) = 'svertexy@gmail.com'
-- returning r.user_id, r.role, r.status;
