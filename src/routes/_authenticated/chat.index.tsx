import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { createThread, listThreads } from "@/lib/threads.functions";

// Entry point: pick the most recent thread (or create one) and open it.
export const Route = createFileRoute("/_authenticated/chat/")({
  head: () => ({
    meta: [{ title: "AI 项目总管" }],
  }),
  component: ChatEntry,
});

function ChatEntry() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const threads = await listThreads();
        const target = threads[0] ?? (await createThread({ data: { title: "新项目" } }));
        if (!cancelled) {
          navigate({
            to: "/chat/$threadId",
            params: { threadId: target.id },
            replace: true,
          });
        }
      } catch (err) {
        console.error(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
