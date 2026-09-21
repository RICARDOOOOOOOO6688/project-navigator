// Client-safe helpers for phone-number normalization (China mainland).
// Accepts "+8613800138000", "8613800138000", "138 0013 8000", "138-0013-8000".
// Normalized form is always the 11-digit mainland number.

export const PHONE_EMAIL_DOMAIN = "phone.projectnavigator.app";

export function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s()-]/g, "");
  let digits = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith("0086")) digits = digits.slice(4);
  else if (digits.length === 13 && digits.startsWith("86")) digits = digits.slice(2);
  if (!/^1[3-9]\d{9}$/.test(digits)) return null;
  return digits;
}

export function phoneToAuthEmail(normalizedPhone: string): string {
  return `p${normalizedPhone}@${PHONE_EMAIL_DOMAIN}`;
}

export function isPhoneAuthEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith(`@${PHONE_EMAIL_DOMAIN}`);
}
