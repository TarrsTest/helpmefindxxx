// Voyage AI embedding provider. voyage-3 returns 1024-d vectors, matching
// the vector(1024) columns. Enabled when VOYAGE_API_KEY is set. Uses fetch
// only — no SDK dependency (SPEC §0).
// Docs: https://docs.voyageai.com/reference/embeddings-api

const MODEL = process.env.VOYAGE_MODEL ?? 'voyage-3';

// Voyage caps a single request at 128 inputs; chunk larger calls (the
// re-embed backfill sends the whole table). Order is preserved so the
// caller's texts[i] still maps to the returned vector[i].
const MAX_BATCH = 128;
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One API call for up to MAX_BATCH texts, with backoff on rate-limit /
// transient server errors. 4xx other than 429 fail fast (bad key, bad
// request) — retrying those just wastes time.
const embedBatch = async (texts: string[]): Promise<number[][]> => {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        },
        body: JSON.stringify({
          input: texts,
          model: MODEL,
          output_dimension: 1024,
        }),
      });
    } catch (err) {
      lastErr = err; // network blip — retry
      await sleep(500 * (attempt + 1));
      continue;
    }

    if (res.ok) {
      const json = (await res.json()) as { data: { embedding: number[] }[] };
      return json.data.map((d) => d.embedding);
    }

    const body = await res.text();
    // Retry only on 429 / 5xx; anything else is a hard failure.
    if (res.status !== 429 && res.status < 500) {
      throw new Error(`Voyage embeddings failed: ${res.status} ${body}`);
    }
    lastErr = new Error(`Voyage embeddings failed: ${res.status} ${body}`);
    await sleep(500 * (attempt + 1));
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('Voyage embeddings failed after retries');
};

export const embedVoyage = async (texts: string[]): Promise<number[][]> => {
  if (texts.length <= MAX_BATCH) return embedBatch(texts);

  // Serialize chunks — the box is small and Voyage rate-limits per key;
  // firing all chunks at once just trips 429s we'd then back off on.
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    out.push(...(await embedBatch(texts.slice(i, i + MAX_BATCH))));
  }
  return out;
};
