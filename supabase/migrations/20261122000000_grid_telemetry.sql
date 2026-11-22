-- =============================================================================
--  VOLT-SPECTRA — Supabase cloud-sync schema
--  Mirrors the IndexedDB stores so the offline-first app can replay its sync
--  queue when connectivity returns. Idempotent: safe to re-run.
--
--  Apply with the Supabase connector:
--    create_migration(project_ref, query)   -- or `supabase db push`
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- grid_audits
create table if not exists public.grid_audits (
  id              uuid primary key,
  frequency_hz    double precision not null,
  thd_percent     double precision not null,
  crest_factor    double precision not null,
  purity_score    double precision not null,
  snr_db          double precision not null,
  nominal_hz      double precision not null,
  verdict         text not null,
  verdict_text    text not null,
  harmonics       double precision[] not null default '{}',
  harmonic_percent double precision[] not null default '{}',
  source          text not null,
  created_at      timestamptz not null default now(),
  synced_at       timestamptz not null default now()
);
create index if not exists grid_audits_created_at_idx on public.grid_audits (created_at desc);

-- --------------------------------------------------------- vampire_appliances
create table if not exists public.vampire_appliances (
  id               uuid primary key,
  name             text not null,
  location         text not null,
  standby_watts    double precision not null,
  annual_kwh       double precision not null,
  annual_cost_usd  double precision not null,
  emf_ut           double precision not null,
  hum_hz           double precision not null,
  severity         text not null,
  added_at         timestamptz not null default now(),
  synced_at        timestamptz not null default now()
);
create index if not exists vampire_appliances_added_at_idx on public.vampire_appliances (added_at desc);

-- ---------------------------------------------------------- smart_meter_reads
create table if not exists public.smart_meter_reads (
  id                    uuid primary key,
  pulse_constant        integer not null,
  pulse_constant_unit   text not null,
  interval_seconds      double precision not null,
  power_w               double precision not null,
  power_kw              double precision not null,
  cost_per_hour_usd     double precision not null,
  projected_monthly_usd double precision not null,
  mode                  text not null,
  created_at            timestamptz not null default now(),
  synced_at             timestamptz not null default now()
);
create index if not exists smart_meter_reads_created_at_idx on public.smart_meter_reads (created_at desc);

-- ------------------------------------------------------------------- RLS
-- Personal offline mirror: the anon key is public by design, so the policy is
-- deliberately permissive. For multi-user deployments, replace these policies
-- with authenticated-user scoping and a service-role sync edge function.
alter table public.grid_audits        enable row level security;
alter table public.vampire_appliances enable row level security;
alter table public.smart_meter_reads  enable row level security;

drop policy if exists "anon mirror access" on public.grid_audits;
create policy "anon mirror access" on public.grid_audits
  for all to anon using (true) with check (true);

drop policy if exists "anon mirror access" on public.vampire_appliances;
create policy "anon mirror access" on public.vampire_appliances
  for all to anon using (true) with check (true);

drop policy if exists "anon mirror access" on public.smart_meter_reads;
create policy "anon mirror access" on public.smart_meter_reads
  for all to anon using (true) with check (true);

-- ------------------------------------------------------------------- view
create or replace view public.v_grid_telemetry as
  select 'grid_audit' as kind, id::text as id, created_at, source as detail,
         thd_percent as metric, verdict as status
  from public.grid_audits
  union all
  select 'vampire', id::text, added_at, name, annual_cost_usd, severity
  from public.vampire_appliances
  union all
  select 'meter_read', id::text, created_at, pulse_constant_unit, power_kw, mode
  from public.smart_meter_reads;
