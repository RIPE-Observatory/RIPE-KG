"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div style={{ maxWidth: "40rem", margin: "0 auto", padding: "5rem 2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Something went wrong</h1>
          <p style={{ color: "#57534e", marginBottom: "1.5rem" }}>
            The application could not be loaded. Please try again or contact the site administrator if the problem persists.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ color: "#92400e", fontWeight: 500, cursor: "pointer", background: "none", border: "none", fontSize: "0.875rem" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
