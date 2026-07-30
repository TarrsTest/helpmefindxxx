// Embedding provider interface (SPEC §2 / §9). The provider is the one
// external dependency that must "pass procurement review", so it lives
// behind this interface — swap the implementation, business code doesn't
// change.
//
// Selection (first configured key wins): GEMINI_API_KEY → Gemini
// (gemini-embedding-001 → 1024-d), else VOYAGE_API_KEY → Voyage
// (voyage-3 → 1024-d), else a deterministic, dependency-free local
// embedding so the whole pipeline runs in dev without any third party.
// The local one is lexical-only (feature hashing), NOT semantic — good
// enough to exercise matching end-to-end; set a real key for quality.
// All three emit 1024-d vectors to match vector(1024). NOTE: providers
// live in different vector spaces — after switching keys, run
// POST /v1/admin/reembed to backfill existing rows into the new space.

import { embedGemini } from './gemini';
import { embedVoyage } from './voyage';
import { embedLocal } from './local';

export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

const provider: EmbeddingProvider = process.env.GEMINI_API_KEY
  ? { name: 'gemini', embed: embedGemini }
  : process.env.VOYAGE_API_KEY
    ? { name: 'voyage', embed: embedVoyage }
    : { name: 'local', embed: embedLocal };

/** Embed one or more texts into 1024-d vectors. */
export const embed = (texts: string[]): Promise<number[][]> =>
  provider.embed(texts);

export const embeddingProviderName = provider.name;
