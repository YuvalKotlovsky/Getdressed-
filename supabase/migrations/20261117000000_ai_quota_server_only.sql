-- Restrict quota consumption to the authorized backend flow.
-- Until now consume_ai_quota() was executable by ANY verified user (it runs with the user's token). The fixed limits already
-- stop that from inflating anything beyond 20/day per account, but a user could still burn their own allowance or probe the
-- function, and it was not tied to our backend at all. The backend now has to present a server-only secret in the request
-- header `x-ai-server-key`; the database stores only its SHA-256. A caller without the right header is refused with 42501,
-- exactly like an unauthenticated one. The user's JWT is still required (auth.uid() identifies WHOSE quota is consumed), so
-- the secret alone cannot be used to spend anyone else's allowance, and the user cannot spend any without the backend.
-- The hash is NOT in this migration: it is set once per environment with admin tooling (see server/README.md). With no hash
-- stored, every call is refused (fail closed).
create table if not exists public.ai_quota_server_keys (
  id          integer primary key default 1 check (id = 1),
  key_sha256  text not null check (key_sha256 ~ '^[0-9a-f]{64}$')
);
alter table public.ai_quota_server_keys enable row level security;
alter table public.ai_quota_server_keys force row level security;
revoke all on table public.ai_quota_server_keys from public, anon, authenticated; -- no policies: only SECURITY DEFINER code reads it

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
  presented text;
  used_day integer;
  used_month integer;
  used_global bigint;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not public.current_user_verified() then raise exception 'email_not_verified' using errcode = '42501'; end if;

  begin
    presented := (nullif(current_setting('request.headers', true), '')::json) ->> 'x-ai-server-key';
  exception when others then presented := null;
  end;
  if presented is null or presented = ''
     or not exists (select 1 from public.ai_quota_server_keys k where k.key_sha256 = encode(sha256(convert_to(presented, 'utf8')), 'hex')) then
    raise exception 'not_server' using errcode = '42501';
  end if;

  select * into lim from public.ai_quota_limits where kind = p_kind;
  if not found then raise exception 'bad_kind' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_quota:' || p_kind, 0));

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
