import { redirect } from "next/navigation";
import { requestVersion } from "@/lib/request-version";
import { releasePath } from "@/lib/versions";

export default async function Home() {
  redirect(releasePath(await requestVersion(), "/explore"));
}
