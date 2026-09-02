import "server-only";
import { headers } from "next/headers";
import { defaultVersion } from "./version-endpoints";
import { isKgVersion, VERSION_HEADER, type KgVersion } from "./versions";

export async function requestVersion(): Promise<KgVersion> {
  const value = (await headers()).get(VERSION_HEADER);
  if (value && isKgVersion(value)) return value;
  return defaultVersion();
}
