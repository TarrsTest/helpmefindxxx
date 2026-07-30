import { EMBEDDING_DIM } from '../config';

// Deterministic, dependency-free fallback embedding via the hashing
// trick: tokenize, hash each token into one of EMBEDDING_DIM buckets
// with a sign, accumulate, L2-normalize. Shared vocabulary → higher
// cosine similarity, so matching is exercisable without a real provider.
// NOT semantically meaningful — set VOYAGE_API_KEY for production quality.

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const embedOne = (text: string): number[] => {
  const vec = new Array(EMBEDDING_DIM).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9一-鿿]+/gi) ?? [];
  for (const tok of tokens) {
    const h = hash(tok);
    const bucket = h % EMBEDDING_DIM;
    const sign = (h >>> 16) & 1 ? 1 : -1;
    vec[bucket] += sign;
  }
  let norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) norm = 1;
  return vec.map((v) => v / norm);
};

export const embedLocal = async (texts: string[]): Promise<number[][]> =>
  texts.map(embedOne);
