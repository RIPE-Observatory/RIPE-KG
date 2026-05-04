"use client";

import { useState } from "react";
import Link from "next/link";

interface Author {
  authorId: string;
  name: string;
  sameAs?: string;
}

const DEFAULT_VISIBLE = 12;

export function ExpandableAuthorList({ authors }: { authors: Author[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? authors : authors.slice(0, DEFAULT_VISIBLE);
  const remaining = authors.length - DEFAULT_VISIBLE;

  return (
    <div className="text-base text-stone-700 leading-relaxed">
      {visible.map((a, i) => (
        <span key={a.authorId}>
          {i > 0 && ", "}
          <Link
            href={`/authors/${encodeURIComponent(a.authorId)}`}
            className="hover-link"
          >
            {a.name}
          </Link>
        </span>
      ))}
      {!expanded && remaining > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          aria-label={`Show ${remaining} more authors`}
          className="text-amber-800 font-medium hover:text-amber-900 transition-colors ml-1"
        >
          +{remaining} more
        </button>
      )}
    </div>
  );
}
