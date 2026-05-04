export default function ExploreLoading() {
  return (
    <div className="min-h-screen bg-background" role="status" aria-label="Loading content">
      <span className="sr-only">Loading…</span>
      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-20 pb-32">
        <div className="h-8 w-64 bg-stone-200 rounded-full animate-pulse mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
          <div className="md:col-span-2 space-y-4">
            <div className="h-12 w-96 bg-stone-200 rounded animate-pulse" />
            <div className="h-12 w-72 bg-stone-200 rounded animate-pulse" />
            <div className="h-5 w-80 bg-stone-200 rounded animate-pulse mt-4" />
          </div>
          <div className="space-y-6 pl-8">
            <div className="h-4 w-24 bg-stone-200 rounded animate-pulse" />
            <div className="h-8 w-20 bg-stone-200 rounded animate-pulse" />
            <div className="h-8 w-20 bg-stone-200 rounded animate-pulse" />
            <div className="h-8 w-24 bg-stone-200 rounded animate-pulse" />
          </div>
        </div>
        <div className="h-12 w-full bg-stone-200 rounded animate-pulse" />
      </div>
    </div>
  );
}
