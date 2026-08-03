-- Miami-Dade Commission Watch: owner/admin roles, meeting reviews, news posts
-- Run this once in the Supabase SQL editor, after supabase/schema.sql.

-- ---------- user_roles: owner role, active/revoked status, email for display ----------
alter table public.user_roles add column if not exists status text not null default 'active' check (status in ('active', 'revoked'));
alter table public.user_roles add column if not exists email text;

alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check check (role in ('owner', 'admin'));

update public.user_roles set role = 'owner', email = 'cagelber1@gmail.com' where user_id = '4a56910c-296d-4209-b16b-520623321085';
update public.user_roles set email = 'daniel.j.llobet@icloud.com' where user_id = 'd4e3d2e2-6cad-429b-a719-961dcd5253f1';

-- Owners can read and update every row (needed for the Staff admin panel);
-- everyone can still read their own row via the existing "Users can read their own role" policy.
create policy "Owners can read all roles"
  on public.user_roles for select
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'owner' and ur.status = 'active'
    )
  );

create policy "Owners can update roles"
  on public.user_roles for update
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'owner' and ur.status = 'active'
    )
  );

-- ---------- editorial_submissions: recognize both owner and admin, require active status ----------
drop policy if exists "Admins can read all submissions" on public.editorial_submissions;
create policy "Staff can read all submissions"
  on public.editorial_submissions for select
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  );

drop policy if exists "Admins can update submissions" on public.editorial_submissions;
create policy "Staff can update submissions"
  on public.editorial_submissions for update
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  );

drop policy if exists "Admins can delete submissions" on public.editorial_submissions;
create policy "Staff can delete submissions"
  on public.editorial_submissions for delete
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  );

-- ---------- meetings ----------
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  meeting_date date not null,
  meeting_type text not null default 'Regular Meeting',
  title text not null,
  summary text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.meetings enable row level security;

create policy "Public can read meetings"
  on public.meetings for select
  using (true);

create policy "Staff can manage meetings"
  on public.meetings for all
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  );

-- ---------- meeting_items (agenda items within a meeting) ----------
create table public.meeting_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  sort_order int not null default 0,
  tag_type text not null default 'outcome' check (tag_type in ('outcome', 'item_code')),
  tag_label text not null,
  tag_status text check (tag_status in ('passed', 'failed', 'deferred')),
  heading text not null,
  description text not null,
  source_label text,
  source_url text,
  why_it_matters text not null
);

alter table public.meeting_items enable row level security;

create policy "Public can read meeting items"
  on public.meeting_items for select
  using (true);

create policy "Staff can manage meeting items"
  on public.meeting_items for all
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  );

-- ---------- news_posts (short staff-written news items) ----------
create table public.news_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.news_posts enable row level security;

create policy "Public can read news posts"
  on public.news_posts for select
  using (true);

create policy "Staff can manage news posts"
  on public.news_posts for all
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  );

-- ---------- After running this file ----------
-- Conrad (4a56910c-296d-4209-b16b-520623321085) is now 'owner': full staff
-- management plus everything admins can do. Daniel stays 'admin': can publish
-- meetings/news and moderate editorials, but cannot manage other staff.
-- New staff invited going forward (via the Staff tab in admin.html) get role
-- 'admin' and an email automatically; only Conrad's owner account can promote,
-- demote, or revoke access from that point on.
