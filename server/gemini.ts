/**
 * Gemini provider on the Interactions API (Google's recommended interface for new projects; generateContent is "legacy but
 * fully supported"). Only called after auth, ownership, size limits and quota have passed. Endpoint, field names and the
 * default model come from Google's official docs (read 2026-11-16, see server/README.md); the first real call (the dev pilot)
 * is what confirms them in practice.
 */
import { RECOGNITION_JSON_SCHEMA } from '../src/tagging/schema';

export interface Usage { input?: number; output?: number; thoughts?: number; total?: number }
export interface ProviderResult { text: string; usage?: Usage }
export interface Provider { analyze(image: { bytes: Buffer; mediaType: string }, prompt: string): Promise<string | ProviderResult> }

export class ProviderError extends Error { constructor(public kind: 'upstream' | 'timeout') { super(kind); } }

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
/** USD per 1M tokens, paid Standard tier for gemini-3.5-flash-lite as printed on Google's pricing page (2026-11-16). Output includes thinking tokens. */
export const PRICE_PER_M = { input: 0.30, output: 2.50 };
export const estimateCostUSD = (u: Usage | undefined) => (u ? ((u.input ?? 0) * PRICE_PER_M.input + ((u.output ?? 0) + (u.thoughts ?? 0)) * PRICE_PER_M.output) / 1e6 : undefined);

export function geminiProvider(env: { apiKey: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxOutputTokens?: number; thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high' }): Provider {
  const model = env.model ?? DEFAULT_GEMINI_MODEL;
  return {
    async analyze(image, prompt) {
      let res: Response;
      try {
        res = await (env.fetchImpl ?? fetch)('https://generativelanguage.googleapis.com/v1beta/interactions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': env.apiKey },
          body: JSON.stringify({
            model,
            input: [{ type: 'text', text: prompt }, { type: 'image', data: image.bytes.toString('base64'), mime_type: image.mediaType }],
            response_format: { type: 'text', mime_type: 'application/json', schema: RECOGNITION_JSON_SCHEMA },
            // max_output_tokens INCLUDES thinking tokens; minimal thinking keeps the answer from being truncated and the cost small
            generation_config: { max_output_tokens: env.maxOutputTokens ?? 1024, thinking_level: env.thinkingLevel ?? 'minimal' },
            store: false, // do not keep the interaction (and the photo) on Google's side
          }),
          signal: AbortSignal.timeout(env.timeoutMs ?? 20000),
        });
      } catch (e) {
        throw new ProviderError((e as Error)?.name === 'TimeoutError' ? 'timeout' : 'upstream');
      }
      if (!res.ok) throw new ProviderError('upstream');
      const data: any = await res.json().catch(() => null);
      if (data?.status && data.status !== 'completed') throw new ProviderError('upstream'); // e.g. "incomplete": output cap hit while thinking
      const steps: any[] = Array.isArray(data?.steps) ? data.steps : [];
      const text = steps.filter((s) => s?.type === 'model_output').flatMap((s) => (Array.isArray(s.content) ? s.content : [])).map((c: any) => (c?.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('');
      if (!text) throw new ProviderError('upstream');
      const u = data?.usage;
      const usage: Usage | undefined = u ? { input: u.total_input_tokens, output: u.total_output_tokens, thoughts: u.total_thought_tokens, total: u.total_tokens } : undefined;
      return { text, usage };
    },
  };
}
