import type { NextRequest } from "next/server";
import { redirectToRipeOntology } from "../ontology-redirect";

export function GET(request: NextRequest, context: { params: Promise<{ version: string }> }) {
  return context.params.then(({ version }) => redirectToRipeOntology(request, version));
}
