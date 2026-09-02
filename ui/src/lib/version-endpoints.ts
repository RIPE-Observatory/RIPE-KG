import "server-only";
import { isKgVersion, LATEST_VERSION, type KgVersion } from "./versions";

export function defaultVersion(): KgVersion {
  const version = process.env.RIPE_KG_VERSION || LATEST_VERSION;
  if (!isKgVersion(version)) throw new Error("Invalid RIPE_KG_VERSION configuration");
  return version;
}

export function endpointForVersion(version: KgVersion): string {
  const repository = `ripe-${version.replaceAll(".", "-")}`;
  const base = (process.env.GRAPHDB_BASE_URL || "http://localhost:7200").replace(/\/$/, "");
  return `${base}/repositories/${repository}`;
}
