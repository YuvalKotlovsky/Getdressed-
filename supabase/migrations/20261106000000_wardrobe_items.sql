-- Wardrobe items: per-user rows synced from the app.
-- Requires a verified (email-confirmed) user in addition to ownership.

-- ---------------------------------------------------------------------------
-- Email verification helper (used by every table and storage policy)
-- ---------------------------------------------------------------------------
create or replace function public.current_user_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;

revoke all on function public.current_user_verified() from public;
revoke all on function public.current_user_verified() from anon;
grant execute on function public.current_user_verified() to authenticated;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.wardrobe_items (
  id          uuid primary key,  -- client-generated; makes upsert retries idempotent
  user_id     uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  data        jsonb not null,
  photo_path  text null,
  deleted_at  timestamptz null,  -- soft-delete tombstone for other devices
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint wardrobe_items_data_is_object
    check (jsonb_typeof(data) = 'object'),
  constraint wardrobe_items_data_size
    check (octet_length(data::text) < 20480),
  constraint wardrobe_items_photo_path_own_folder
    check (
      photo_path is null
      or photo_path like (user_id::text || '/' || id::text || '/%')
    ),
  constraint wardrobe_items_photo_path_length
    check (photo_path is null or char_length(photo_path) <= 200),
  constraint wardrobe_items_photo_path_no_traversal
    check (photo_path is null or position('..' in photo_path) = 0)
);

create index if not exists wardrobe_items_user_id_updated_at_idx
  on public.wardrobe_items (user_id, updated_at);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
-- updated_at is always server-controlled (insert, update, and upsert-on-conflict).
-- clock_timestamp() (not now()) so a long transaction does not stamp an old time.
create or replace function public.wardrobe_items_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.wardrobe_items_lock_user_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'wardrobe_items.user_id cannot be changed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.wardrobe_items_set_updated_at() from public, anon, authenticated;
revoke all on function public.wardrobe_items_lock_user_id() from public, anon, authenticated;

drop trigger if exists wardrobe_items_set_updated_at_ins on public.wardrobe_items;
create trigger wardrobe_items_set_updated_at_ins
  before insert on public.wardrobe_items
  for each row execute function public.wardrobe_items_set_updated_at();

drop trigger if exists wardrobe_items_set_updated_at_upd on public.wardrobe_items;
create trigger wardrobe_items_set_updated_at_upd
  before update on public.wardrobe_items
  for each row execute function public.wardrobe_items_set_updated_at();

drop trigger if exists wardrobe_items_lock_user_id on public.wardrobe_items;
create trigger wardrobe_items_lock_user_id
  before update on public.wardrobe_items
  for each row execute function public.wardrobe_items_lock_user_id();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on table public.wardrobe_items from public;
revoke all on table public.wardrobe_items from anon;
grant select, insert, update, delete on table public.wardrobe_items to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.wardrobe_items enable row level security;
alter table public.wardrobe_items force row level security;

drop policy if exists wardrobe_items_select_own on public.wardrobe_items;
create policy wardrobe_items_select_own
  on public.wardrobe_items
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.current_user_verified())
  );

drop policy if exists wardrobe_items_insert_own on public.wardrobe_items;
create policy wardrobe_items_insert_own
  on public.wardrobe_items
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.current_user_verified())
  );

drop policy if exists wardrobe_items_update_own on public.wardrobe_items;
create policy wardrobe_items_update_own
  on public.wardrobe_items
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.current_user_verified())
  )
  with check (
    user_id = (select auth.uid())
    and (select public.current_user_verified())
  );

drop policy if exists wardrobe_items_delete_own on public.wardrobe_items;
create policy wardrobe_items_delete_own
  on public.wardrobe_items
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.current_user_verified())
  );
