import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import type { Item } from '../types';

/** Photo to show for an item: the local copy, or a short-lived signed URL for a photo saved from another device. */
export function useItemPhoto(item: Pick<Item, 'photoUri' | 'photoPath' | 'id'>): string | undefined {
  const { resolvePhoto } = useApp();
  const [uri, setUri] = useState<string | undefined>(item.photoUri);
  useEffect(() => {
    let live = true;
    if (item.photoUri) { setUri(item.photoUri); return; }
    setUri(undefined);
    resolvePhoto(item as Item).then((u) => { if (live) setUri(u); });
    return () => { live = false; };
  }, [item.photoUri, item.photoPath, item.id, resolvePhoto]);
  return uri;
}
