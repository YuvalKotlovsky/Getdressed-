-- Durable per-user quota for paid AI calls (photo analysis). The backend calls consume_ai_quota() with the CALLER's
-- Supabase session (no service-role key), BEFORE any provider call. The function is SECURITY DEFINER, but it only ever
-- touches the row of auth.uid(), so a user can at most burn their own allowance; nobody can reset or raise a counter.
-- Limits are arguments chosen by the backend; a client that calls the RPC directly gains nothing (the backend is the only
-- caller that leads to a provider request).
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  kind    text not null check (kind in ('analyze_photo')),
  count   integer not null default 0 check (count >= 0),
  primary key (user_id, day, kind)
);

alter table public.ai_usage enable row level security;
alter table public.ai_usage force row level security;

revoke all on table public.ai_usage from public, anon, authenticated;
grant select on table public.ai_usage to authenticated;

drop policy if exists ai_usage_select_own on public.ai_usage;
create policy ai_usage_select_own on public.ai_usage
  for select to authenticated
  using (user_id = (select auth.uid()) and public.current_user_verified());
-- No insert/update/delete policies: counters change only through consume_ai_quota().

create or replace function public.consume_ai_quota(p_kind text, p_day_limit integer, p_month_limit integer, p_global_day_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  month_start date := date_trunc('month', now() at time zone 'utc')::date;
  used_day integer;
  used_month integer;
  used_global bigint;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not public.current_user_verified() then raise exception 'email_not_verified' using errcode = '42501'; end if;
  if p_kind is distinct from 'analyze_photo' then raise exception 'bad_kind' using errcode = '22023'; end if;
  if p_day_limit is null or p_month_limit is null or p_global_day_limit is null
     or p_day_limit < 1 or p_month_limit < 1 or p_global_day_limit < 1
     or p_day_limit > 10000 or p_month_limit > 100000 or p_global_day_limit > 1000000 then
    raise exception 'bad_limits' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_kind, 0)); -- one decision at a time per user

  select coalesce(sum(count), 0) into used_day from public.ai_usage where user_id = uid and kind = p_kind and day = today;
  select coalesce(sum(count), 0) into used_month from public.ai_usage where user_id = uid and kind = p_kind and day >= month_start;
  select coalesce(sum(count), 0) into used_global from public.ai_usage where kind = p_kind and day = today;

  if used_day >= p_day_limit then return jsonb_build_object('allowed', false, 'scope', 'day', 'used', used_day, 'limit', p_day_limit); end if;
  if used_month >= p_month_limit then return jsonb_build_object('allowed', false, 'scope', 'month', 'used', used_month, 'limit', p_month_limit); end if;
  if used_global >= p_global_day_limit then return jsonb_build_object('allowed', false, 'scope', 'global', 'used', used_global, 'limit', p_global_day_limit); end if;

  insert into public.ai_usage (user_id, day, kind, count) values (uid, today, p_kind, 1)
    on conflict (user_id, day, kind) do update set count = public.ai_usage.count + 1;

  return jsonb_build_object('allowed', true, 'scope', 'ok', 'used', used_day + 1, 'limit', p_day_limit);
end;
$$;

revoke all on function public.consume_ai_quota(text, integer, integer, integer) from public, anon;
grant execute on function public.consume_ai_quota(text, integer, integer, integer) to authenticated;
