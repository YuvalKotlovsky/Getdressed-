import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cloudConfig } from './config';
import type { CloudApi, RemoteRow } from './engine';

export const BUCKET = 'closet-photos';
let client: SupabaseClient | null = null;

/** Single shared client. Session is kept in AsyncStorage; only the public URL + anon key are used. */
export function getSupabase(): SupabaseClient | null {
  const cfg = cloudConfig();
  if (!cfg.ok) return null;
  if (!client) {
    client = createClient(cfg.url, cfg.anonKey, {
      auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: Platform.OS === 'web' },
    });
  }
  return client;
}

/**
 * CloudApi backed by Supabase. Every call runs as the signed-in user, so RLS and storage policies apply.
 * `user_id` is sent explicitly: a request still in flight after an account switch is rejected by RLS instead of landing in the new account.
 */
export function supabaseApi(sb: SupabaseClient, userId: string): CloudApi {
  const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };
  return {
    async upsertItem(row) {
      const { error } = await sb.from('wardrobe_items').upsert({ id: row.id, user_id: userId, data: row.data, photo_path: row.photo_path, deleted_at: null }, { onConflict: 'id' });
      fail(error);
    },
    async tombstoneItem(id) {
      const { error } = await sb.from('wardrobe_items').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId);
      fail(error);
    },
    async listChanged(after, limit) {
      let q = sb.from('wardrobe_items').select('id,data,photo_path,deleted_at,updated_at').order('updated_at', { ascending: true }).limit(limit);
      if (after) q = q.gt('updated_at', after);
      const { data, error } = await q;
      fail(error);
      return (data ?? []) as RemoteRow[];
    },
    async uploadPhoto(path, bytes) {
      const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
      fail(error);
    },
    async removePhotos(paths) {
      if (!paths.length) return;
      const { error } = await sb.storage.from(BUCKET).remove(paths);
      fail(error);
    },
    async signedUrl(path, ttl) {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, ttl);
      fail(error);
      if (!data?.signedUrl) throw new Error('no signed url');
      return data.signedUrl;
    },
  };
}
