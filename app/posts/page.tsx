import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPenToSquare, faTrash } from '@fortawesome/free-solid-svg-icons';
import { createClient } from '@/lib/supabase/server';

/**
 * RSC reads + Server Action writes — the canonical "one-service"
 * pattern for this template. The page renders on the server (so the
 * Supabase fetch never crosses the network from a browser), and
 * mutations call `'use server'` actions that go straight to Postgres.
 *
 * Authorization is RLS-driven (see supabase/migrations/001_posts.sql):
 *   - read: any signed-in user
 *   - insert / update / delete: only the author
 * We deliberately do NOT re-check ownership in code — the policy is
 * the source of truth, and a duplicated check drifts the day the
 * policy changes.
 */

interface Post {
  id: string;
  title: string;
  body: string;
  author_id: string;
  created_at: string;
}

const createPost = async (formData: FormData) => {
  'use server';
  // Defensive validation. Server actions accept arbitrary FormData —
  // a script could POST a 50 MB body. Length-cap before touching DB.
  const title = String(formData.get('title') ?? '').trim().slice(0, 200);
  const body = String(formData.get('body') ?? '').trim().slice(0, 10_000);
  if (title.length < 1 || body.length < 1) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('posts').insert({
    title,
    body,
    author_id: user.id,
  });
  revalidatePath('/posts');
};

const deletePost = async (formData: FormData) => {
  'use server';
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const supabase = await createClient();
  // RLS handles the "only the author can delete" check. The delete
  // returns 0 rows for non-owners — which we treat as a no-op, same
  // shape as not-found. No leak of "row exists but isn't yours."
  await supabase.from('posts').delete().eq('id', id);
  revalidatePath('/posts');
};

export default async function PostsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: posts } = await supabase
    .from('posts')
    .select('id, title, body, author_id, created_at')
    .order('created_at', { ascending: false });

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold tracking-tight mb-6">Posts</h1>

        <form
          action={createPost}
          className="rounded-xl border border-zinc-200 p-5 mb-8 space-y-3"
        >
          <input
            type="text"
            name="title"
            required
            placeholder="Title"
            className="w-full h-10 px-3 rounded-lg border border-zinc-300 focus:outline-none focus:border-violet-500"
          />
          <textarea
            name="body"
            rows={3}
            required
            placeholder="What's on your mind?"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 focus:outline-none focus:border-violet-500"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700"
          >
            <FontAwesomeIcon icon={faPenToSquare} className="w-3.5 h-3.5" />
            Publish
          </button>
        </form>

        <ul className="space-y-3">
          {(posts as Post[] | null)?.map((p) => (
            <li
              key={p.id}
              className="rounded-xl border border-zinc-200 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold mb-1">{p.title}</h2>
                {p.author_id === user.id && (
                  <form action={deletePost}>
                    <input type="hidden" name="id" value={p.id} />
                    <button
                      type="submit"
                      className="text-zinc-400 hover:text-red-600 transition-colors"
                      title="Delete"
                    >
                      <FontAwesomeIcon icon={faTrash} className="w-3.5 h-3.5" />
                    </button>
                  </form>
                )}
              </div>
              <p className="text-sm text-zinc-600 whitespace-pre-wrap">
                {p.body}
              </p>
              <div className="mt-2 text-xs text-zinc-400 font-mono">
                {new Date(p.created_at).toLocaleString()}
              </div>
            </li>
          ))}
          {posts?.length === 0 && (
            <li className="text-sm text-zinc-500 text-center py-8">
              No posts yet — create the first one above.
            </li>
          )}
        </ul>
      </div>
    </main>
  );
}
