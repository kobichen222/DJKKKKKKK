-- TITAN OFFICE — admin back-office schema.
-- Run this in Supabase SQL Editor AFTER running auth.sql.
-- Extends the profiles table with admin-managed tables for
-- licenses and promo deals. All tables are RLS-locked to admins.

-- ============================================================
-- LICENSES — every PRO license issued by the admin
-- ============================================================
create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  tier text not null default 'pro' check (tier in ('pro','team','lifetime','trial')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked boolean not null default false,
  revoked_at timestamptz,
  payload jsonb not null,      -- the {tier,email,expiresAt,...} object signed by HMAC
  signature text not null,     -- hex HMAC-SHA256 of payload
  notes text,
  stripe_session_id text,
  created_by uuid references auth.users on delete set null
);

create index if not exists licenses_email_idx on public.licenses(email);
create index if not exists licenses_expires_idx on public.licenses(expires_at);

alter table public.licenses enable row level security;
drop policy if exists "licenses_admin_all" on public.licenses;
create policy "licenses_admin_all" on public.licenses
  for all using (public.current_role_is('admin'))
  with check (public.current_role_is('admin'));

-- ============================================================
-- DEALS — promo codes / discounts the admin can create
-- ============================================================
create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text,
  kind text not null default 'percent' check (kind in ('percent','fixed','bundle','free-month')),
  amount numeric not null default 0,  -- % or $ depending on kind
  currency text default 'USD',
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  max_uses integer,                   -- null = unlimited
  used_count integer not null default 0,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null
);

create index if not exists deals_code_idx on public.deals(code);
create index if not exists deals_active_idx on public.deals(active);

alter table public.deals enable row level security;
drop policy if exists "deals_admin_all" on public.deals;
create policy "deals_admin_all" on public.deals
  for all using (public.current_role_is('admin'))
  with check (public.current_role_is('admin'));
-- Deals that customers redeem are typically looked up from a Stripe webhook
-- or server-side function; clients shouldn't read the table directly.

-- ============================================================
-- AUDIT LOG — what the admin did, when, to whom
-- ============================================================
create table if not exists public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users on delete set null,
  actor_email text,
  action text not null,               -- 'ban_user' | 'issue_license' | 'create_deal' | ...
  target_type text,                   -- 'profile' | 'license' | 'deal'
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit enable row level security;
drop policy if exists "audit_admin_all" on public.admin_audit;
create policy "audit_admin_all" on public.admin_audit
  for all using (public.current_role_is('admin'))
  with check (public.current_role_is('admin'));
