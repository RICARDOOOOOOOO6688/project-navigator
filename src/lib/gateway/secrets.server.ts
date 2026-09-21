// Server-only secret resolution + sanitization for the AI Gateway.
// The resolved value is only ever held in a local variable; it is never logged,
// returned, or persisted.

export type SecretResolution = { ok: true; value: string } | { ok: false; reason: string };

export function resolveSecret(
  secretRef: string | null | undefined,
  secretSource: string,
): SecretResolution {
  const ref = secretRef?.trim();
  if (!ref) return { ok: false, reason: "missing secret_ref" };

  if (secretSource === "supabase_vault") {
    // Out of scope for this phase — never fake success.
    return { ok: false, reason: "supabase_vault not connected" };
  }

  const value = process.env[ref]?.trim();
  if (!value) return { ok: false, reason: `env binding ${ref} not found` };
  return { ok: true, value };
}

/** Strip anything that looks like the secret before a message leaves the gateway. */
export function sanitizeSecretText(text: string, secrets: (string | null | undefined)[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join("***");
  }
  out = out.replace(/Bearer\s+\S+/gi, "Bearer ***");
  out = out.replace(/\b(sk|app|key)-[A-Za-z0-9._-]{6,}/gi, "$1-***");
  return out.slice(0, 300);
}
