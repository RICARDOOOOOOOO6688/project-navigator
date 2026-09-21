import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { normalizePhone, phoneToAuthEmail } from "@/lib/phone";

// Phone accounts are NOT Supabase phone auth (that would require SMS OTP).
// Instead we create a normal Supabase Auth user with a deterministic internal
// email derived from the normalized phone number, mark it confirmed (the
// address is internal and cannot receive mail), and record the mapping in
// public.phone_accounts so the number stays unique.
// The service role key is only ever used inside these server handlers.

const phoneSchema = z.object({
  phone: z.string().trim().min(1).max(32),
  password: z.string().min(6).max(72),
});

function normalizeOrThrow(phone: string): string {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error("手机号格式不正确，请输入 11 位中国大陆手机号（可带 +86）");
  return normalized;
}

export const registerPhoneAccount = createServerFn({ method: "POST" })
  .validator((input: unknown) => phoneSchema.parse(input))
  .handler(async ({ data }) => {
    const phone = normalizeOrThrow(data.phone);
    const email = phoneToAuthEmail(phone);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("phone_accounts")
      .select("user_id")
      .eq("phone", phone)
      .maybeSingle();
    if (lookupError) {
      console.error("[phone-auth] lookup failed:", lookupError.message);
      throw new Error("注册失败，请稍后重试");
    }
    if (existing) throw new Error("该手机号已注册，请直接登录");

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { phone, account_type: "phone" },
    });
    if (createError || !created.user) {
      console.error("[phone-auth] createUser failed:", createError?.message, createError?.status);
      const message = createError?.message ?? "";
      if (/already/i.test(message)) throw new Error("该手机号已注册，请直接登录");
      throw new Error("注册失败，请稍后重试");
    }

    const { error: mapError } = await supabaseAdmin
      .from("phone_accounts")
      .insert({ user_id: created.user.id, phone });
    if (mapError) {
      console.error("[phone-auth] mapping insert failed:", mapError.message, mapError.code);
      // Roll back the auth user so a failed mapping never leaves an orphan.
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      if (mapError.code === "23505") throw new Error("该手机号已注册，请直接登录");
      throw new Error("注册失败，请稍后重试");
    }

    return { phone, email };
  });
