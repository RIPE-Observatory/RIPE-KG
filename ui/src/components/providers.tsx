"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import { VersionContext } from "./version-link";
import type { KgVersion } from "@/lib/versions";

export function Providers({ children, version }: { children: ReactNode; version: KgVersion }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10 * 60 * 1000, // KG data changes rarely
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return <VersionContext.Provider value={version}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></VersionContext.Provider>;
}
