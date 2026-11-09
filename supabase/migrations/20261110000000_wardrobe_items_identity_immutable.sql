-- Item identity is immutable: `id` can never change after insert (user_id was already locked by
-- wardrobe_items_lock_user_id). Closes the hole where the owner could UPDATE the id of a tombstone, making the old id
-- vanish so that a stale device's upsert of the old id would INSERT a live row (resurrection).
-- Normal edits and idempotent upserts (INSERT .. ON CONFLICT (id) DO UPDATE keeps the same id) are unaffected.
create or replace function public.wardrobe_items_identity_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'wardrobe_items.id cannot be changed'
      using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'wardrobe_items.user_id cannot be changed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.wardrobe_items_identity_immutable() from public, anon, authenticated;

drop trigger if exists wardrobe_items_identity_immutable on public.wardrobe_items;
create trigger wardrobe_items_identity_immutable
  before update on public.wardrobe_items
  for each row execute function public.wardrobe_items_identity_immutable();
