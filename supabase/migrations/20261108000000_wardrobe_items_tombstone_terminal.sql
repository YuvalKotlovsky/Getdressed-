-- Conflict rule: DELETE WINS. A soft-deleted item (deleted_at set) is terminal.
-- Any later write that would edit it or clear deleted_at (a stale edit from another device) is rejected
-- with the stable message 'item_deleted' (SQLSTATE P0001). Repeating the delete is allowed and keeps the
-- original deleted_at. To bring an item back, the client saves a NEW item with a new id.
-- Applies to plain UPDATEs and to INSERT ... ON CONFLICT DO UPDATE (upsert), because both fire BEFORE UPDATE.
-- Between two live edits the last write still wins.
--
-- Note: the owner can still hard-delete a row through the API (DELETE policy). The app never does; the
-- tombstone is what other devices rely on, and purging tombstones is a future backend job.

create or replace function public.wardrobe_items_tombstone_terminal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is not null then
    if new.deleted_at is null
       or new.data is distinct from old.data
       or new.photo_path is distinct from old.photo_path then
      raise exception 'item_deleted'
        using errcode = 'P0001',
              hint = 'This item was deleted. A deleted item cannot be edited or restored; save it as a new item instead.';
    end if;
    new.deleted_at := old.deleted_at; -- repeated delete: keep the original time
  end if;
  return new;
end;
$$;

revoke all on function public.wardrobe_items_tombstone_terminal() from public, anon, authenticated;

drop trigger if exists wardrobe_items_tombstone_terminal on public.wardrobe_items;
create trigger wardrobe_items_tombstone_terminal
  before update on public.wardrobe_items
  for each row execute function public.wardrobe_items_tombstone_terminal();
