// Streaming fallback for /map. The page is force-dynamic and waits on a
// DB round-trip, so without this the user stares at a blank document.
// Mirrors the real layout's dimensions to avoid a jump when data lands.

export default function MapLoading() {
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-6">
        <div className="h-7 w-40 animate-pulse rounded bg-zinc-800" />
        <div className="mt-2 h-4 w-full max-w-xl animate-pulse rounded bg-zinc-900" />
      </header>

      <div className="relative aspect-[900/560] w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-zinc-900/60 to-transparent" />
        <p className="absolute inset-0 flex items-center justify-center text-sm text-zinc-600">
          Loading the map…
        </p>
      </div>

      <div className="mt-3 h-3 w-28 animate-pulse rounded bg-zinc-900" />
    </main>
  );
}
