/** Gemini provider. Only called after auth, ownership, size limits and quota have passed. */
export interface Provider { analyze(image: { bytes: Buffer; mediaType: string }, prompt: string): Promise<string> }

export class ProviderError extends Error { constructor(public kind: 'upstream' | 'timeout') { super(kind); } }

export function geminiProvider(env: { apiKey: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxOutputTokens?: number }): Provider {
  const model = env.model ?? 'gemini-2.5-flash-lite';
  return {
    async analyze(image, prompt) {
      let res: Response;
      try {
        res = await (env.fetchImpl ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': env.apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ inline_data: { mime_type: image.mediaType, data: image.bytes.toString('base64') } }, { text: prompt }] }],
            generationConfig: { temperature: 0, maxOutputTokens: env.maxOutputTokens ?? 500, responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(env.timeoutMs ?? 20000),
        });
      } catch (e) {
        throw new ProviderError((e as Error)?.name === 'TimeoutError' ? 'timeout' : 'upstream');
      }
      if (!res.ok) throw new ProviderError('upstream');
      const data: any = await res.json().catch(() => null);
      const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
      if (!text) throw new ProviderError('upstream');
      return text;
    },
  };
}
