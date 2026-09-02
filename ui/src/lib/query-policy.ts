import { Parser } from "@traqula/parser-sparql-1-1";

const parser = new Parser();
const SERVICES = new Set(["https://semopenalex.org/sparql"]);
export const MAX_QUERY_LENGTH = 20_000;
// Must match the verified GraphDB query-limit-results setting.
export const MAX_RESULT_ROWS = 100_000;

export function validateQuery(query: string): string | null {
  if (!query.trim()) return "Request must contain a SPARQL query";
  if (query.length > MAX_QUERY_LENGTH) return "Query exceeds 20,000 characters";
  try {
    // Parsing is synchronous; reuse the parser without concurrent parse calls.
    const ast = parser.parse(query);
    if (ast.type !== "query" || !["select", "ask"].includes(ast.subType)) {
      return "Only SELECT and ASK queries are supported";
    }
    const pending: unknown[] = [ast];
    while (pending.length) {
      const node = pending.pop();
      if (!node || typeof node !== "object") continue;
      const value = node as Record<string, unknown>;
      if (value.type === "pattern" && value.subType === "service") {
        const name = value.name as { subType?: string; value?: string };
        if (name.subType !== "namedNode" || !SERVICES.has(name.value ?? "")) {
          return "SERVICE requires the explicit IRI <https://semopenalex.org/sparql>";
        }
      }
      pending.push(...Object.values(value));
    }
    return null;
  } catch {
    return "Invalid SPARQL 1.1 query";
  }
}
