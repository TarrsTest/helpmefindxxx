'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEnvelope, faCheck } from '@fortawesome/free-solid-svg-icons';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setErr(null);
    setSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setSubmitting(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setSent(true);
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-violet-100 text-violet-600 mb-5">
          <FontAwesomeIcon icon={sent ? faCheck : faEnvelope} className="w-4 h-4" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          {sent ? 'Check your email' : 'Sign in'}
        </h1>
        <p className="text-sm text-zinc-600 mb-6">
          {sent
            ? `We sent a magic link to ${email}. Click it to sign in.`
            : 'Enter your email — we’ll send you a magic link.'}
        </p>

        {!sent && (
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-11 px-4 rounded-lg border border-zinc-300 focus:outline-none focus:border-violet-500"
            />
            {err && (
              <p className="text-sm text-red-600">{err}</p>
            )}
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="w-full h-11 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-40"
            >
              {submitting ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
