import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, MessageSquareText, Pencil, Plus, Trash2 } from "lucide-react";
import {
  getProject,
  listTasks,
  createTask,
  updateTaskStatus,
  deleteTask,
  listDecisions,
  createDecision,
  listProjectFacts,
  updateProjectStage,
  updateProject,
} from "@/lib/projects.functions";
import { STAGES, type StageId } from "@/lib/threads.functions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/projects/$projectId/")({
  head: () => ({
    meta: [
      { title: "项目总览 · AI 项目总管" },
      {
        name: "description",
        content: "查看项目阶段进度、下一步任务、最近决策与关键事实。",
      },
      { property: "og:title", content: "项目总览 · AI 项目总管" },
      {
        property: "og:description",
        content: "查看项目阶段进度、下一步任务、最近决策与关键事实。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProjectOverview,
});

function ProjectOverview() {
  const { projectId } = useParams({
    from: "/_authenticated/projects/$projectId/",
  });
  const queryClient = useQueryClient();
  const [newTask, setNewTask] = useState("");
  const [newDecision, setNewDecision] = useState("");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject({ data: { projectId } }),
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => listTasks({ data: { projectId } }),
  });
  const { data: decisions = [] } = useQuery({
    queryKey: ["decisions", projectId],
    queryFn: () => listDecisions({ data: { projectId } }),
  });
  const { data: facts = [] } = useQuery({
    queryKey: ["facts", projectId],
    queryFn: () => listProjectFacts({ data: { projectId } }),
  });

  useEffect(() => {
    if (project && !editing) {
      setTitle(project.title);
      setDescription(project.description ?? "");
    }
  }, [project, editing]);

  const saveProjectMutation = useMutation({
    mutationFn: () =>
      updateProject({
        data: { projectId, title: title.trim() || "新项目", description },
      }),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const stageMutation = useMutation({
    mutationFn: (stage: StageId) => updateProjectStage({ data: { projectId, stage } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
  });

  const addTaskMutation = useMutation({
    mutationFn: (t: string) => createTask({ data: { projectId, title: t } }),
    onSuccess: () => {
      setNewTask("");
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });

  const toggleTaskMutation = useMutation({
    mutationFn: ({ taskId, done }: { taskId: string; done: boolean }) =>
      updateTaskStatus({ data: { taskId, status: done ? "todo" : "done" } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", projectId] }),
  });

  const removeTaskMutation = useMutation({
    mutationFn: (taskId: string) => deleteTask({ data: { taskId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", projectId] }),
  });

  const addDecisionMutation = useMutation({
    mutationFn: (t: string) => createDecision({ data: { projectId, title: t } }),
    onSuccess: () => {
      setNewDecision("");
      queryClient.invalidateQueries({ queryKey: ["decisions", projectId] });
    },
  });

  const stageIndex = Math.max(
    0,
    STAGES.findIndex((s) => s.id === project?.stage),
  );
  const stageProgress = Math.round(((stageIndex + 1) / STAGES.length) * 100);
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const nextTasks = tasks.filter((t) => t.status !== "done").slice(0, 5);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <section className="rounded-xl border border-border bg-card p-5">
        {editing ? (
          <div className="space-y-3">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="项目名称"
            />
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="用一段话描述这个创业/竞赛想法…"
              rows={3}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => saveProjectMutation.mutate()}>
                保存
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                取消
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">{project?.title ?? "项目总览"}</h2>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                {project?.description?.trim()
                  ? project.description
                  : "还没有项目描述，点击右侧编辑补充。"}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil /> 编辑
            </Button>
            <Button size="sm" asChild>
              <Link to="/projects/$projectId/chat" params={{ projectId }}>
                <MessageSquareText /> AI 总管
              </Link>
            </Button>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">项目阶段</h3>
          <span className="text-xs text-muted-foreground">进度 {stageProgress}%</span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${stageProgress}%` }}
          />
        </div>
        <ol className="mt-4 flex flex-wrap items-center gap-2">
          {STAGES.map((stage, i) => {
            const isCurrent = i === stageIndex;
            const isDone = i < stageIndex;
            return (
              <li key={stage.id} className="flex items-center gap-2">
                {i > 0 && <span className="h-px w-4 bg-border" />}
                <button
                  onClick={() => stageMutation.mutate(stage.id)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    isCurrent
                      ? "border-primary bg-primary/15 text-primary"
                      : isDone
                        ? "border-primary/40 text-primary/80"
                        : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {stage.label}
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-2xl font-semibold">
            {doneCount}/{tasks.length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">任务完成</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-2xl font-semibold">{decisions.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">关键决策</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-2xl font-semibold">{facts.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">项目知识</p>
        </div>
      </div>

      <section className="mt-4 rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-medium text-muted-foreground">下一步任务</h3>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newTask.trim()) addTaskMutation.mutate(newTask.trim());
          }}
        >
          <Input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder="添加一个任务…"
            className="flex-1"
          />
          <Button type="submit" size="sm" disabled={!newTask.trim()}>
            <Plus /> 添加
          </Button>
        </form>
        <ul className="mt-4 space-y-1.5">
          {nextTasks.length === 0 && (
            <li className="text-sm text-muted-foreground">
              暂无待办任务。也可以在 AI 总管对话中讨论后手动记录。
            </li>
          )}
          {nextTasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2 text-sm">
              <button
                onClick={() => toggleTaskMutation.mutate({ taskId: task.id, done: false })}
                className="text-muted-foreground transition-colors hover:text-primary"
                aria-label="标记为完成"
              >
                <Circle className="size-4" />
              </button>
              <span className="flex-1">{task.title}</span>
              <button
                onClick={() => removeTaskMutation.mutate(task.id)}
                className="text-muted-foreground transition-colors hover:text-destructive"
                aria-label="删除任务"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
          {doneCount > 0 && (
            <li className="pt-2 text-xs text-muted-foreground">已完成 {doneCount} 项</li>
          )}
          {tasks
            .filter((t) => t.status === "done")
            .slice(0, 5)
            .map((task) => (
              <li key={task.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                <button
                  onClick={() => toggleTaskMutation.mutate({ taskId: task.id, done: true })}
                  aria-label="标记为未完成"
                >
                  <CheckCircle2 className="size-4 text-primary" />
                </button>
                <span className="line-through">{task.title}</span>
              </li>
            ))}
        </ul>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted-foreground">最近决策</h3>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newDecision.trim()) addDecisionMutation.mutate(newDecision.trim());
            }}
          >
            <Input
              value={newDecision}
              onChange={(e) => setNewDecision(e.target.value)}
              placeholder="记录一条关键决策…"
              className="flex-1"
            />
            <Button type="submit" size="sm" disabled={!newDecision.trim()}>
              <Plus />
            </Button>
          </form>
          <ul className="mt-4 space-y-2 text-sm">
            {decisions.length === 0 && <li className="text-muted-foreground">还没有记录决策。</li>}
            {decisions.slice(0, 5).map((d) => (
              <li key={d.id}>
                <p>{d.title}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(d.created_at).toLocaleDateString("zh-CN")}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">关键事实</h3>
            <Link
              to="/projects/$projectId/$section"
              params={{ projectId, section: "knowledge" }}
              className="text-xs text-primary hover:underline"
            >
              管理
            </Link>
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            {facts.length === 0 && (
              <li className="text-muted-foreground">还没有项目知识，去「项目知识」添加。</li>
            )}
            {facts.slice(0, 6).map((f) => (
              <li key={f.id} className="flex gap-3">
                <span className="w-28 shrink-0 text-muted-foreground">{f.key}</span>
                <span className="flex-1 truncate">{f.value}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
