import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRight, faBolt } from '@fortawesome/free-solid-svg-icons';
import { createClient } from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-xl text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-violet-100 text-violet-600 mb-6">
          <FontAwesomeIcon icon={faBolt} className="w-5 h-5" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-3">
          Hello from Tarrs
        </h1>
        <p className="text-zinc-600 mb-8">
          {user
            ? `Signed in as ${user.email}`
            : 'A Next.js + Supabase starter, ready for your first feature.'}
        </p>
        <Link
          href={user ? '/dashboard' : '/login'}
          className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors"
        >
          {user ? 'Open dashboard' : 'Sign in'}
          <FontAwesomeIcon icon={faArrowRight} className="w-3.5 h-3.5" />
        </Link>
      </div>
    </main>
  );
}
