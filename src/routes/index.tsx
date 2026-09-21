import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI 项目总管" },
      {
        name: "description",
        content:
          "输入你的创业或竞赛想法，与 AI Agent 对话，完成从想法、市场调研到架构设计、项目构建的全流程。",
      },
      { property: "og:title", content: "AI 项目总管" },
      {
        property: "og:description",
        content: "与 AI Agent 对话，完成从想法到项目构建的全流程。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      navigate({ to: data.session ? "/chat" : "/auth", replace: true });
    });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
