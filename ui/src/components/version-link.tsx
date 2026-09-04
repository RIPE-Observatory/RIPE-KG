"use client";

import NextLink from "next/link";
import { createContext, useContext, type ComponentProps } from "react";
import { LATEST_VERSION, versionedHref, type KgVersion } from "@/lib/versions";

export const VersionContext = createContext<KgVersion>(LATEST_VERSION);
export const useKgVersion = () => useContext(VersionContext);

export default function VersionLink(props: ComponentProps<typeof NextLink>) {
  const version = useKgVersion();
  const href = typeof props.href === "string" ? versionedHref(props.href, version) : props.href;
  return <NextLink {...props} href={href} />;
}
