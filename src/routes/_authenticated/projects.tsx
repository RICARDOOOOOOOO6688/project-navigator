import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, FolderKanban, ArrowRight } from "lucide-react";
import { listProjects, createProject } from "@/lib/projects.functions";
import { STAGES } from "@/lib/threads.functions";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo.png";

export const Route = createFileRoute("/_authenticated/projects")({
  head: () => ({ meta: [{ title: "我的项目 · AI 项目总管" }] }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(),
  });

  const handleCreate = async () => {
    const project = await createProject({ data: { title: "新项目" } });
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    navigate({
      to: "/projects/$projectId",
      params: { projectId: project.id },
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-2.5 border-b border-border px-6 py-4">
        <img src={logo} alt="AI 项目总管" className="size-8" />
        <span className="text-base font-semibold tracking-tight">AI 项目总管</span>
        <Button onClick={handleCreate} size="sm" className="ml-auto">
          <Plus /> 新建项目
        </Button>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <h1 className="text-xl font-semibold">我的项目</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          每个项目拥有独立的 AI 总管对话、任务、决策与项目知识。
        </p>

        {isLoading ? (
          <p className="mt-10 text-sm text-muted-foreground">加载中…</p>
        ) : projects.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">还没有项目，点击「新建项目」开始。</p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const stageLabel = STAGES.find((s) => s.id === project.stage)?.label ?? "想法";
              return (
                <Link
                  key={project.id}
                  to="/projects/$projectId"
                  params={{ projectId: project.id }}
                  className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FolderKanban className="size-4" />
                    <span className="text-xs">{stageLabel}</span>
                  </div>
                  <h2 className="mt-2 truncate text-base font-medium">{project.title}</h2>
                  <div className="mt-4 flex items-center gap-1 text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    进入项目 <ArrowRight className="size-3.5" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
