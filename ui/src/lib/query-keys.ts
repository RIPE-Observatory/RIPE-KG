export const queryKeys = {
  publications: {
    all: ["publications"] as const,
    search: (term: string) => ["publications", "search", term] as const,
  },
  authors: {
    all: ["authors"] as const,
    search: (term: string) => ["authors", "search", term] as const,
  },
  stats: ["stats"] as const,
} as const;
