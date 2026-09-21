import { createFileRoute, Link, Outlet, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  MessageSquareText,
  Search,
  Package,
  Blocks,
  Rocket,
  BookOpen,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getProject } from "@/lib/projects.functions";
import { STAGES } from "@/lib/threads.functions";
import logo from "@/assets/logo.png";

const NAV_ITEMS: Array<{
  to: string;
  section?: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact: boolean;
}> = [
  { to: "/projects/$projectId", label: "项目总览", icon: LayoutDashboard, exact: true },
  { to: "/projects/$projectId/chat", label: "AI 总管", icon: MessageSquareText, exact: false },
  {
    to: "/projects/$projectId/$section",
    section: "research",
    label: "研究",
    icon: Search,
    exact: false,
  },
  {
    to: "/projects/$projectId/$section",
    section: "product",
    label: "产品",
    icon: Package,
    exact: false,
  },
  {
    to: "/projects/$projectId/$section",
    section: "architecture",
    label: "架构",
    icon: Blocks,
    exact: false,
  },
  {
    to: "/projects/$projectId/$section",
    section: "build",
    label: "构建",
    icon: Rocket,
    exact: false,
  },
  {
    to: "/projects/$projectId/$section",
    section: "knowledge",
    label: "项目知识",
    icon: BookOpen,
    exact: false,
  },
];

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  component: ProjectLayout,
});

function ProjectLayout() {
  const { projectId } = useParams({
    from: "/_authenticated/projects/$projectId",
  });
  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject({ data: { projectId } }),
  });

  const stageLabel = STAGES.find((s) => s.id === project?.stage)?.label ?? "想法";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <img src={logo} alt="" className="size-7" />
        <Link
          to="/projects"
          className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> 全部项目
        </Link>
        <h1 className="truncate text-sm font-medium">{project?.title ?? "…"}</h1>
        <span className="ml-auto shrink-0 rounded-full border border-primary/30 bg-primary/10 px-3 py-0.5 text-xs text-primary">
          {stageLabel}
        </span>
      </header>

      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3 py-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const params = "section" in item ? { projectId, section: item.section } : { projectId };
          return (
            <Link
              key={item.label}
              to={item.to as never}
              params={params as never}
              activeOptions={{ exact: item.exact }}
              activeProps={{
                className: "bg-sidebar-accent text-foreground border-border",
              }}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-transparent px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className={cn("min-h-0 flex-1 overflow-y-auto")}>
        <Outlet />
      </div>
    </div>
  );
}
