import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getProjectThread } from "@/lib/threads.functions";
import { ProjectChatWorkspace } from "@/components/project-chat";

export const Route = createFileRoute("/_authenticated/projects/$projectId/chat")({
  head: () => ({ meta: [{ title: "AI 总管 · AI 项目总管" }] }),
  component: ProjectChatPage,
});

function ProjectChatPage() {
  const { projectId } = useParams({
    from: "/_authenticated/projects/$projectId/chat",
  });
  const { data: thread, isLoading } = useQuery({
    queryKey: ["project-thread", projectId],
    queryFn: () => getProjectThread({ data: { projectId } }),
  });

  if (isLoading || !thread) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <ProjectChatWorkspace key={thread.id} threadId={thread.id} hideSidebar />;
}
