// Dataset releases are independent of the RIPE-O and INSPECT-AI vocabulary versions.
import releases from "./releases.json";
export const RELEASES = releases;

export type KgVersion = keyof typeof RELEASES;
export const LATEST_VERSION: KgVersion = "1.1.0";
export const VERSION_HEADER = "x-ripe-kg-version";
export const PATH_HEADER = "x-ripe-kg-path";

export function isKgVersion(value: string): value is KgVersion {
  return Object.hasOwn(RELEASES, value);
}

export function releasePath(version: KgVersion, path = ""): string {
  return `/releases/${version}${path}`;
}

export function legacyReleasePath(path: string): string | null {
  const match = path.match(/^\/ripe-kg\/(\d+\.\d+\.\d+)(\/.*)?$/);
  if (!match) return null;
  const suffix = match[2] === "/" ? "" : match[2] || "";
  const route = !suffix || /^\/(?:explore|sparql|ontology|api\/(?:sparql|health))\/?$/.test(suffix)
    ? suffix
    : `/ripe-kg${suffix}`;
  return `/releases/${match[1]}${route}`;
}

export function versionedHref(href: string, version: KgVersion): string {
  if (!/^\/(?:$|explore(?:[/?#]|$)|sparql(?:[/?#]|$)|ontology(?:[/?#]|$)|publications\/|assessments\/|authors\/|reviewers\/|ripe-kg(?:[/?#]|$)|api\/sparql(?:[?#]|$))/.test(href)) {
    return href;
  }
  return releasePath(version, href === "/" ? "/explore" : href);
}

export function stripReleasePath(path: string): string {
  return path.replace(/^\/releases\/[^/]+(?=\/|$)/, "") || "/";
}
