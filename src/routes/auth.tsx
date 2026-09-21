import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { registerPhoneAccount } from "@/lib/phone-auth.functions";
import { normalizePhone, phoneToAuthEmail } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import logo from "@/assets/logo.png";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "登录 · AI 项目总管" },
      { name: "description", content: "登录 AI 项目总管，与你的 AI 项目 Agent 对话。" },
      { property: "og:title", content: "登录 · AI 项目总管" },
      { property: "og:description", content: "登录 AI 项目总管，与你的 AI 项目 Agent 对话。" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup";
type Method = "phone" | "email";

function errText(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [method, setMethod] = useState<Method>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/chat" });
    });
  }, [navigate]);

  const reset = () => {
    setError(null);
    setNotice(null);
  };

  const handleEmail = async () => {
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw new Error(/invalid login/i.test(error.message) ? "邮箱或密码不正确" : error.message);
      }
      navigate({ to: "/chat" });
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setNotice("注册成功！请查收确认邮件后再登录。");
    }
  };

  const handlePhone = async () => {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new Error("手机号格式不正确，请输入 11 位中国大陆手机号（可带 +86）");
    }
    const authEmail = phoneToAuthEmail(normalized);

    if (mode === "signup") {
      await registerPhoneAccount({ data: { phone: normalized, password } });
      const { error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password,
      });
      if (error) throw new Error("注册成功，但自动登录失败，请手动登录");
      navigate({ to: "/chat" });
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password,
    });
    // 统一错误提示，不区分"手机号未注册"和"密码错误"，避免账号枚举。
    if (error) throw new Error("手机号或密码不正确");
    navigate({ to: "/chat" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    reset();
    try {
      if (method === "email") await handleEmail();
      else await handlePhone();
    } catch (err) {
      setError(errText(err, "操作失败，请重试"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background bg-grid-glow px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card/80 p-8 shadow-2xl backdrop-blur">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img src={logo} alt="AI 项目总管" className="size-14" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">AI 项目总管</h1>
            <p className="mt-1 text-sm text-muted-foreground">从想法到构建，一个 Agent 全程陪跑</p>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1 text-sm">
          {(["phone", "email"] as Method[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMethod(m);
                reset();
              }}
              className={`rounded-md py-1.5 transition-colors ${
                method === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "phone" ? "手机号" : "邮箱"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {method === "phone" ? (
            <div className="space-y-2">
              <Label htmlFor="phone">手机号</Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="13800138000 或 +8613800138000"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-primary">{notice}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            {mode === "signin" ? "登录" : "注册"}
          </Button>
        </form>

        {method === "phone" && (
          <p className="mt-3 rounded-md border border-border/60 bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
            本阶段手机号仅作为登录标识，不发送短信、不做归属验证。
            未绑定邮箱的手机号账号暂不支持自助找回密码，请妥善保管密码，后续可在账号设置中补绑邮箱。
          </p>
        )}

        <p className="mt-4 text-center text-sm text-muted-foreground">
          {mode === "signin" ? "还没有账号？" : "已有账号？"}
          <button
            type="button"
            className="ml-1 text-primary hover:underline"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              reset();
            }}
          >
            {mode === "signin" ? "注册" : "登录"}
          </button>
        </p>
      </div>
    </div>
  );
}
