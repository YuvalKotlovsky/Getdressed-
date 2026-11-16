import { RECOGNITION_PROMPT, extractJson, normalizeRecognition } from '../src/tagging/schema';
import { verifySession, type SupabaseServerEnv, type Verified } from './auth';
import type { QuotaStore } from './quota';
import { ProviderError, type Provider } from './gemini';

export const MAX_IMAGE_BYTES = 1_500_000;           // decoded image
export const MAX_BODY_BYTES = 2_600_000;            // JSON body incl. base64 overhead; enforced by the HTTP layer too
const PATH_RE = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.jpg$/i; // {user}/{item}/{photo}.jpg, same contract as the storage policy

export interface PhotoStore { download(user: { userId: string; token: string }, path: string, maxBytes: number): Promise<{ bytes: Buffer } | 'not_found' | 'too_large' | 'error'> }

export interface AnalysisDeps {
  supabase: SupabaseServerEnv;
  quota: QuotaStore;
  provider?: Provider;       // undefined = not configured
  photos: PhotoStore;
  /** users with a request in flight (one at a time per user caps cost multiplication); single-instance only */
  inFlight?: Set<string>;
  maxImageBytes?: number;
}

export function sniffImage(b: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

type Out = { status: number; json: unknown };
const err = (status: number, error: string, extra: Record<string, unknown> = {}): Out => ({ status, json: { error, ...extra } });

/**
 * Order matters and is the contract (see tests/photo-analysis.test.ts):
 * session -> request shape -> ownership -> size/type -> (busy) -> photo load -> QUOTA -> provider.
 * Nothing before the quota step costs money; nothing that fails validation consumes quota.
 */
export async function analyzePhoto(authorization: string | undefined, body: any, deps: AnalysisDeps, verified?: Verified): Promise<Out> {
  // The HTTP layer verifies BEFORE reading the body and passes the result in; direct callers (tests, scripts) get it verified here.
  let user = verified;
  if (!user) {
    const auth = await verifySession(authorization, deps.supabase);
    if (!auth.ok) return err(auth.status, auth.error);
    user = auth.user;
  }
  if (!deps.provider) return err(503, 'not_configured');

  const hasImage = typeof body?.image === 'string' && body.image.length > 0;
  const hasPath = typeof body?.photoPath === 'string' && body.photoPath.length > 0;
  if (hasImage === hasPath) return err(400, 'bad_request'); // exactly one of image / photoPath

  const max = deps.maxImageBytes ?? MAX_IMAGE_BYTES;
  let bytes: Buffer | undefined;
  if (hasPath) {
    const m = PATH_RE.exec(body.photoPath);
    if (!m) return err(400, 'bad_request');
    // ownership: the folder must be the VERIFIED user's id (the storage RLS policy is a second layer behind this)
    if (m[1].toLowerCase() !== user.userId.toLowerCase()) return err(403, 'forbidden');
  } else {
    if (body.image.length > Math.ceil((max * 4) / 3) + 8) return err(413, 'too_large');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body.image)) return err(400, 'bad_image');
    bytes = Buffer.from(body.image, 'base64');
    if (bytes.length > max) return err(413, 'too_large');
  }

  const inFlight = deps.inFlight;
  if (inFlight) { if (inFlight.has(user.userId)) return err(429, 'busy'); inFlight.add(user.userId); }
  try {
    if (hasPath) {
      const r = await deps.photos.download(user, body.photoPath, max);
      if (r === 'not_found') return err(404, 'not_found');   // also what RLS returns for someone else's object
      if (r === 'too_large') return err(413, 'too_large');
      if (r === 'error') return err(502, 'storage');
      bytes = r.bytes;
    }
    const mediaType = sniffImage(bytes!);
    if (!mediaType) return err(415, 'bad_media'); // magic bytes decide, not the declared type

    const q = await deps.quota.consume(user, 'analyze_photo');
    if (q.allowed === 'error') return err(503, 'quota_unavailable'); // fail closed: no quota decision, no provider call
    if (q.allowed === false) return err(429, 'quota_exceeded', { scope: q.scope, limit: q.limit });

    let text: string;
    try { text = await deps.provider.analyze({ bytes: bytes!, mediaType }, RECOGNITION_PROMPT); }
    catch (e) { return err(502, e instanceof ProviderError && e.kind === 'timeout' ? 'upstream_timeout' : 'upstream'); } // the attempt stays counted: no retries that multiply cost
    const n = normalizeRecognition(extractJson(text));
    if (!n.ok) return n.error === 'not_garment' ? err(422, 'not_garment') : err(502, 'invalid');
    return { status: 200, json: { suggestion: n.suggestion, quota: { used: q.used, limit: q.limit } } };
  } finally {
    inFlight?.delete(user.userId);
  }
}

/** Reads a stored photo with the CALLER's token, so storage RLS applies as well. */
export function supabasePhotos(env: { url: string; anonKey: string; fetchImpl?: typeof fetch }): PhotoStore {
  return {
    async download(user, path, maxBytes) {
      try {
        const res = await (env.fetchImpl ?? fetch)(`${env.url.replace(/\/+$/, '')}/storage/v1/object/authenticated/closet-photos/${path.split('/').map(encodeURIComponent).join('/')}`, {
          headers: { authorization: `Bearer ${user.token}`, apikey: env.anonKey },
          signal: AbortSignal.timeout(10000),
        });
        if (res.status === 400 || res.status === 404 || res.status === 403) return 'not_found';
        if (!res.ok) return 'error';
        const len = Number(res.headers.get('content-length') ?? 0);
        if (len > maxBytes) return 'too_large';
        const buf = Buffer.from(await res.arrayBuffer());
        return buf.length > maxBytes ? 'too_large' : { bytes: buf };
      } catch { return 'error'; }
    },
  };
}
