import { redirect } from 'next/navigation';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser } from '@fortawesome/free-solid-svg-icons';
import { createClient } from '@/lib/supabase/server';
import SignOutButton from '@/components/SignOutButton';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <SignOutButton />
        </header>

        <section className="rounded-xl border border-zinc-200 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center">
              <FontAwesomeIcon icon={faUser} className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="text-sm font-semibold">{user.email}</div>
              <div className="text-xs text-zinc-500 font-mono">
                {user.id}
              </div>
            </div>
          </div>
          <p className="text-sm text-zinc-600 mt-4">
            You’re signed in. Open a Tarrs ticket to add features.
          </p>
        </section>
      </div>
    </main>
  );
}
