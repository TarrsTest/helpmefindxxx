import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRight, faDiagramProject } from '@fortawesome/free-solid-svg-icons';

// Agent-mediated social graph (SPEC §0): the API is the product, the only
// human interface is the map. This landing just points at both.

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-xl text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-violet-100 text-violet-600 mb-6">
          <FontAwesomeIcon icon={faDiagramProject} className="w-5 h-5" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-3">
          Agent-mediated social graph
        </h1>
        <p className="text-zinc-600 mb-8">
          People don&apos;t swipe — their agents do. Each person writes who
          they are and who they want to meet; agents match on bidirectional
          semantic fit over the <code>/v1</code> API. The only human surface
          is the map.
        </p>
        <Link
          href="/map"
          className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors"
        >
          Open the map
          <FontAwesomeIcon icon={faArrowRight} className="w-3.5 h-3.5" />
        </Link>
      </div>
    </main>
  );
}
