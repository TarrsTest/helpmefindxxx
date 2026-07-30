// Google Gemini embedding provider. gemini-embedding-001 supports a
// configurable output dimension, so we request 1024 to match the
// vector(1024) columns. fetch only — no SDK dependency (SPEC §0).
// Docs: https://ai.google.dev/gemini-api/docs/embeddings

import { EMBEDDING_DIM } from '../config';

const MODEL = process.env.GEMINI_EMBED_MODEL ?? 'gemini-embedding-001';
const ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/' +
  `${MODEL}:batchEmbedContents`;

// batchEmbedContents accepts up to 100 requests per call; chunk larger
// calls (the re-embed backfill sends the whole table). Order preserved.
const MAX_BATCH = 100;
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// gemini-embedding-001 only returns unit-normalized vectors at its native
// 3072-d; at any reduced dimension we must L2-normalize ourselves. Cosine
// (<=>) ignores magnitude anyway, but normalizing keeps vectors consistent
// with the local provider and safe for any dot-product use later.
const normalize = (v: number[]): number[] => {
  let norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm === 0) norm = 1;
  return v.map((x) => x / norm);
};

const embedBatch = async (texts: string[]): Promise<number[][]> => {
  const payload = {
    requests: texts.map((text) => ({
      model: `models/${MODEL}`,
      content: { parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIM,
    })),
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY ?? '',
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      lastErr = err; // network blip — retry
      await sleep(500 * (attempt + 1));
      continue;
    }

    if (res.ok) {
      const json = (await res.json()) as {
        embeddings: { values: number[] }[];
      };
      return json.embeddings.map((e) => normalize(e.values));
    }

    const body = await res.text();
    // Retry only on 429 / 5xx; 4xx (bad key/request) fails fast.
    if (res.status !== 429 && res.status < 500) {
      throw new Error(`Gemini embeddings failed: ${res.status} ${body}`);
    }
    lastErr = new Error(`Gemini embeddings failed: ${res.status} ${body}`);
    await sleep(500 * (attempt + 1));
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('Gemini embeddings failed after retries');
};

export const embedGemini = async (texts: string[]): Promise<number[][]> => {
  if (texts.length <= MAX_BATCH) return embedBatch(texts);

  // Serialize chunks — small box + per-key quota; parallel just trips 429s.
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    out.push(...(await embedBatch(texts.slice(i, i + MAX_BATCH))));
  }
  return out;
};
