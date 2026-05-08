import type { NextRequest } from "next/server";
import { redirectToRipeOntology } from "./ontology-redirect";

export function GET(request: NextRequest) {
  return redirectToRipeOntology(request);
}
