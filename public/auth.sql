-- DJ MAX Ai — Supabase RLS schema
-- Run this SQL in your Supabase project's SQL Editor (once).
-- Then enable Google OAuth and Phone auth in Authentication → Providers.

-- ============================================================
-- PROFILES TABLE (extends auth.users with app-specific fields)
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  phone text,
  name text,
  avatar_url text,
  role text not null default 'user' check (role in ('user','admin')),
  banned boolean not null default false,
  tier text not null default 'beginner' check (tier in ('beginner','pro')),
  api_key uuid not null default gen_random_uuid(),
  pro_since timestamptz,
  pro_until timestamptz,
  created_at timestamptz not null default now(),
  last_login timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

-- Idempotent column adds for projects that already created the table
-- before these fields existed.
alter table public.profiles
  add column if not exists tier text not null default 'beginner' check (tier in ('beginner','pro'));
alter table public.profiles
  add column if not exists api_key uuid not null default gen_random_uuid();
alter table public.profiles
  add column if not exists pro_since timestamptz;
alter table public.profiles
  add column if not exists pro_until timestamptz;
update public.profiles set api_key = gen_random_uuid() where api_key is null;

-- Auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles(id, email, phone, name, avatar_url, tier, api_key)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email, new.phone),
    new.raw_user_meta_data->>'avatar_url',
    'beginner',
    gen_random_uuid()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: current user's role
create or replace function public.current_role_is(r text)
returns boolean language sql stable security definer as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = r);
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;

drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_admin_read_all" on public.profiles;
create policy "profiles_admin_read_all" on public.profiles
  for select using (public.current_role_is('admin'));

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    -- User cannot escalate role, change their tier, regenerate their
    -- api_key, or move pro_since/until — only admins (or server-side
    -- functions, e.g. a Stripe webhook) can flip those fields.
    and role     = (select role     from public.profiles where id = auth.uid())
    and tier     = (select tier     from public.profiles where id = auth.uid())
    and api_key  = (select api_key  from public.profiles where id = auth.uid())
    and pro_since is not distinct from (select pro_since from public.profiles where id = auth.uid())
    and pro_until is not distinct from (select pro_until from public.profiles where id = auth.uid())
  );

drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all" on public.profiles
  for all using (public.current_role_is('admin'))
  with check (public.current_role_is('admin'));

-- ============================================================
-- SESSIONS / PLAYLISTS / HISTORY (optional — per-user private)
-- ============================================================
create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.user_sessions enable row level security;
drop policy if exists "sessions_self" on public.user_sessions;
create policy "sessions_self" on public.user_sessions
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
drop policy if exists "sessions_admin" on public.user_sessions;
create policy "sessions_admin" on public.user_sessions
  for select using (public.current_role_is('admin'));

-- ============================================================
-- MAKE YOURSELF ADMIN (run once after your first sign-up)
-- Replace the email below with the email you signed up with.
-- ============================================================
-- update public.profiles set role = 'admin' where email = 'you@example.com';

-- ============================================================
-- REQUIRED DASHBOARD STEPS AFTER RUNNING THIS SQL:
-- 1. Authentication → Providers → Enable Google
--    - Paste your Google OAuth Client ID + Secret (from console.cloud.google.com)
-- 2. Authentication → Providers → Enable Phone
--    - Connect Twilio or MessageBird; for WhatsApp use Twilio's
--      WhatsApp Sandbox / Approved WA Sender.
-- 3. Authentication → URL Configuration → add your site URL
--    (e.g. https://djkobikobi.vercel.app).
-- 4. Settings → API → copy Project URL + anon public key into
--    the app (Settings → Auth).
-- ============================================================
