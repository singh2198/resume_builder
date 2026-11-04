-- Run once in this app's Supabase SQL Editor. Safe to rerun. No public/anon policies.
begin;
create table if not exists public.rf_runs (
  id text primary key, created timestamptz not null, label text not null,
  result jsonb not null, owner text not null
);
create index if not exists rf_runs_owner_created on public.rf_runs(owner,created desc);
create table if not exists public.rf_purchases (
  id text primary key, token_hash text not null,
  created timestamptz not null, order_id text unique, payment_id text unique,
  status text not null default 'pending' check (status in ('pending','paid')),
  filename text not null, content_type text not null,
  amount integer not null check (amount > 0),
  artifact_path text unique not null, artifact_sha256 text not null,
  artifact_size integer not null check (artifact_size > 0)
);
create table if not exists public.rf_ai_usage (day date primary key, requests integer not null check (requests > 0));
alter table public.rf_runs enable row level security;
alter table public.rf_purchases enable row level security;
alter table public.rf_ai_usage enable row level security;
revoke all on public.rf_runs, public.rf_purchases, public.rf_ai_usage from public, anon, authenticated;
grant select,insert,update,delete on public.rf_runs, public.rf_purchases, public.rf_ai_usage to service_role;
create or replace function public.rf_consume_ai_budget(p_day date,p_limit integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare used integer;
begin
  if p_limit <= 0 then return false; end if;
  insert into public.rf_ai_usage(day,requests) values(p_day,1)
    on conflict(day) do update set requests=rf_ai_usage.requests+1
    where rf_ai_usage.requests < p_limit returning requests into used;
  return used is not null;
end;
$$;
revoke all on function public.rf_consume_ai_budget(date,integer) from public,anon,authenticated;
grant execute on function public.rf_consume_ai_budget(date,integer) to service_role;
insert into storage.buckets(id,name,public,file_size_limit)
values('resume-fit-purchases','resume-fit-purchases',false,33554432)
on conflict(id) do update set public=false,file_size_limit=33554432;
commit;
