import { endpointForVersion } from "@/lib/version-endpoints";
import { requestVersion } from "@/lib/request-version";
import { RELEASES, VERSION_HEADER } from "@/lib/versions";

export async function GET() {
  const version = await requestVersion();
  const headers = { [VERSION_HEADER]: version, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": VERSION_HEADER };
  try {
    const response = await fetch(endpointForVersion(version), {
      method: "POST",
      headers: { "Content-Type": "application/sparql-query", Accept: "application/sparql-results+json" },
      body: `PREFIX ripe: <https://w3id.org/ripe/ripe-o#>
SELECT (COUNT(DISTINCT ?a) AS ?assessments) (COUNT(DISTINCT ?w) AS ?publications)
WHERE { ?a a ripe:ResearchIntegrityAssessment; ripe:assesses ?w }`,
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Unavailable");
    const row = (await response.json()).results.bindings[0];
    const assessments = Number(row.assessments.value);
    const publications = Number(row.publications.value);
    const ok = assessments === RELEASES[version].assessments && publications === RELEASES[version].publications;
    return Response.json({ version, ok, assessments, publications }, { status: ok ? 200 : 503, headers });
  } catch {
    return Response.json({ version, ok: false }, { status: 503, headers });
  }
}
