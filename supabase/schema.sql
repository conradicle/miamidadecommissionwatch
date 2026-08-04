-- Miami-Dade Commission Watch: editorial submissions + admin roles
-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query).

-- ---------- user_roles ----------
-- Extensible role table. Only 'admin' is used today; more roles can be
-- added later without changing this schema.
create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

create policy "Users can read their own role"
  on public.user_roles for select
  using (auth.uid() = user_id);

-- ---------- editorial_submissions ----------
create table public.editorial_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  grade text not null,
  school text not null,
  school_email text not null,
  title text not null,
  topic text,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

alter table public.editorial_submissions enable row level security;

-- Anyone (including anonymous site visitors) can submit an editorial.
create policy "Anyone can submit an editorial"
  on public.editorial_submissions for insert
  with check (true);

-- The public can only ever see approved editorials.
create policy "Public can read approved editorials"
  on public.editorial_submissions for select
  using (status = 'approved');

-- Admins can read every submission regardless of status.
create policy "Admins can read all submissions"
  on public.editorial_submissions for select
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role = 'admin'
    )
  );

-- Admins can update status (approve/reject) and review metadata.
create policy "Admins can update submissions"
  on public.editorial_submissions for update
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role = 'admin'
    )
  );

-- Admins can delete spam or duplicate submissions.
create policy "Admins can delete submissions"
  on public.editorial_submissions for delete
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role = 'admin'
    )
  );

-- ---------- After running this file ----------
-- 1. Authentication > Users > Invite user, once for you and once for Daniel
--    (email invite lets each of you set your own password; never share one).
-- 2. Copy each new user's UUID from that Users list.
-- 3. Run, once per admin:
--    insert into public.user_roles (user_id, role) values ('<uuid-here>', 'admin');
