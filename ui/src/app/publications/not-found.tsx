import Link from "@/components/version-link";

export default function PublicationNotFound() {
  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-20 text-center">
      <h1 className="font-libre text-2xl text-stone-900 mb-4">Publication not found</h1>
      <p className="text-base text-stone-600 mb-6">This version does not contain this publication.</p>
      <Link href="/explore" className="hover-link text-base font-medium text-amber-800">Back to explore</Link>
    </div>
  );
}
