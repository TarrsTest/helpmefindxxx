'use client';

import { useRouter } from 'next/navigation';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import { createClient } from '@/lib/supabase/client';

export default function SignOutButton() {
  const router = useRouter();
  const onClick = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-zinc-200 text-sm text-zinc-700 hover:bg-zinc-50"
    >
      <FontAwesomeIcon icon={faRightFromBracket} className="w-3 h-3" />
      Sign out
    </button>
  );
}
