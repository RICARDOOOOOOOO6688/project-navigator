// Client-safe model catalog. Contains NO provider endpoints, keys or real model
// names — only the abstract ModelKey the browser is allowed to talk about.

export const MODEL_KEYS = ["default", "gpt", "claude", "gemini", "deepseek", "qwen"] as const;

export type ModelKey = (typeof MODEL_KEYS)[number];

export const DEFAULT_MODEL_KEY: ModelKey = "default";

export type ModelCatalogEntry = {
  key: ModelKey;
  label: string;
  description: string;
  /** "enabled": routed server-side today. "planned": selectable UI only, not callable. */
  status: "enabled" | "planned";
};

export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  {
    key: "default",
    label: "默认总管",
    description: "由你配置的 Dify Agent 驱动",
    status: "enabled",
  },
  { key: "gpt", label: "GPT", description: "尚未接入", status: "planned" },
  { key: "claude", label: "Claude", description: "尚未接入", status: "planned" },
  { key: "gemini", label: "Gemini", description: "尚未接入", status: "planned" },
  {
    key: "deepseek",
    label: "DeepSeek",
    description: "尚未接入",
    status: "planned",
  },
  { key: "qwen", label: "通义千问", description: "尚未接入", status: "planned" },
];

export function isModelKey(value: unknown): value is ModelKey {
  return typeof value === "string" && (MODEL_KEYS as readonly string[]).includes(value);
}

export function getModelEntry(key: ModelKey): ModelCatalogEntry {
  return MODEL_CATALOG.find((m) => m.key === key) ?? MODEL_CATALOG[0]!;
}
