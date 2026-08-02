// Vitest does NOT populate process.env from .env on its own — Vite only
// exposes VITE_-prefixed vars, and then only via import.meta.env. Without
// this import, createAdminClient() gets an undefined URL and every test that
// touches Supabase fails with a confusing error instead of a clear one.
import 'dotenv/config';

// Fail fast, and name the missing variable rather than letting a null-ish
// client blow up three layers deep. Values are never logged — only names.
const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

const missing = REQUIRED.filter((name) => !process.env[name]);

if (missing.length > 0) {
  throw new Error(
    `Missing env for the test suite: ${missing.join(', ')}.\n` +
      `These come from .env in the repo root. If .env is absent, run ` +
      `\`tarrs-cli db wire\` to write it — never paste Supabase keys by hand.`,
  );
}
