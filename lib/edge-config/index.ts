import { get } from "@vercel/edge-config";

export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  return ((await get<T>(key)) ?? fallback);
}

type EdgeConfigKey =
  | "no_show_timeout_min"
  | "followup_after_call_min"
  | "extension_min"
  | "max_extensions_per_ticket"
  | "eta_recompute_interval_sec"
  | "colors_by_party_size";

export async function getTypedConfig<T>(key: EdgeConfigKey, fallback: T): Promise<T> {
  return ((await get<T>(key)) ?? fallback);
}
