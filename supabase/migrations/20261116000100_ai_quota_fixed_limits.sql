-- Review fix (B1): migration 20261116000000 let the CALLER choose the limits (p_*_limit arguments). Because the function is
-- callable by any verified user, one account could call it directly with huge limits, inflate the project-wide daily count
-- and trip the global ceiling for everybody. The limits now live in a table that nobody but the owner (via admin tooling)
-- can read or change, the function takes only the kind, and a user's own contribution to the global count is capped by
-- the fixed per-day limit. The older function stays in history (migrations are immutable) but is dropped here.
create table if not exists public.ai_quota_limits (
  kind            text primary key check (kind in ('analyze_photo')),
  per_day         integer not null check (per_day between 1 and 10000),
  per_month       integer not null check (per_month between 1 and 100000),
  global_per_day  integer not null check (global_per_day between 1 and 1000000)
);
alter table public.ai_quota_limits enable row level security;
alter table public.ai_quota_limits force row level security;
revoke all on table public.ai_quota_limits from public, anon, authenticated; -- no policies: only SECURITY DEFINER code reads it

insert into public.ai_quota_limits (kind, per_day, per_month, global_per_day) values ('analyze_photo', 20, 200, 500)
  on conflict (kind) do nothing;

create index if not exists ai_usage_kind_day_idx on public.ai_usage (kind, day); -- global daily sum

drop function if exists public.consume_ai_quota(text, integer, integer, integer);

create or replace function public.consume_ai_quota(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  month_start date := date_trunc('month', now() at time zone 'utc')::date;
  lim public.ai_quota_limits%rowtype;
  used_day integer;
  used_month integer;
  used_global bigint;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not public.current_user_verified() then raise exception 'email_not_verified' using errcode = '42501'; end if;
  select * into lim from public.ai_quota_limits where kind = p_kind;
  if not found then raise exception 'bad_kind' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_quota:' || p_kind, 0)); -- one decision at a time: the global ceiling is exact

  select coalesce(sum(count), 0) into used_day from public.ai_usage where user_id = uid and kind = p_kind and day = today;
  select coalesce(sum(count), 0) into used_month from public.ai_usage where user_id = uid and kind = p_kind and day >= month_start;
  select coalesce(sum(count), 0) into used_global from public.ai_usage where kind = p_kind and day = today;

  if used_day >= lim.per_day then return jsonb_build_object('allowed', false, 'scope', 'day', 'used', used_day, 'limit', lim.per_day); end if;
  if used_month >= lim.per_month then return jsonb_build_object('allowed', false, 'scope', 'month', 'used', used_month, 'limit', lim.per_month); end if;
  if used_global >= lim.global_per_day then return jsonb_build_object('allowed', false, 'scope', 'global', 'used', used_global, 'limit', lim.global_per_day); end if;

  insert into public.ai_usage (user_id, day, kind, count) values (uid, today, p_kind, 1)
    on conflict (user_id, day, kind) do update set count = public.ai_usage.count + 1;

  return jsonb_build_object('allowed', true, 'scope', 'ok', 'used', used_day + 1, 'limit', lim.per_day);
end;
$$;

revoke all on function public.consume_ai_quota(text) from public, anon;
grant execute on function public.consume_ai_quota(text) to authenticated;
