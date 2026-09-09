import { notFound } from "next/navigation";
import { isKgVersion } from "@/lib/versions";

export default async function VersionLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ version: string }>;
}) {
  if (!isKgVersion((await params).version)) notFound();
  return children;
}
