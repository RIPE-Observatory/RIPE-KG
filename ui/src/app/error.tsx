"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-20 text-center">
      <h1 className="font-libre text-2xl text-stone-900 mb-4">
        Something went wrong
      </h1>
      <p className="text-base text-stone-600 mb-6">
        The page could not be loaded. Please try again or contact the site administrator if the problem persists.
      </p>
      <button
        type="button"
        onClick={reset}
        className="text-base font-medium text-amber-800 hover:text-amber-900 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
