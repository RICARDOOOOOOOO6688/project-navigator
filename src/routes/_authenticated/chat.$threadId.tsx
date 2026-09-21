import { createFileRoute } from "@tanstack/react-router";
import { ProjectChatWorkspace } from "@/components/project-chat";

export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  head: () => ({
    meta: [
      { title: "项目对话 · AI 项目总管" },
      {
        name: "description",
        content: "与 AI Agent 对话，推进你的想法、市场调研、架构设计与项目构建。",
      },
      { property: "og:title", content: "项目对话 · AI 项目总管" },
      {
        property: "og:description",
        content: "与 AI Agent 对话，推进你的想法、市场调研、架构设计与项目构建。",
      },
    ],
  }),
  component: ChatThreadPage,
});

function ChatThreadPage() {
  const { threadId } = Route.useParams();
  // Key by threadId so switching threads fully resets chat state.
  return <ProjectChatWorkspace key={threadId} threadId={threadId} />;
}
