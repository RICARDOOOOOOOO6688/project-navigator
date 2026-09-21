import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Search,
  Package,
  Blocks,
  Rocket,
  BookOpen,
  MessageSquareText,
  Plus,
  Trash2,
} from "lucide-react";
import { listProjectFacts, upsertProjectFact, deleteProjectFact } from "@/lib/projects.functions";
import { isWorkflowConnected, type WorkflowKey } from "@/lib/workflows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SECTIONS = {
  research: {
    label: "研究",
    icon: Search,
    description:
      "市场调研工作流：竞品分析、用户访谈纪要、市场规模测算等，由专门的研究 Workflow 驱动。",
  },
  product: {
    label: "产品",
    icon: Package,
    description: "产品工作流：需求拆解、PRD 生成、功能优先级排序等，由专门的产品 Workflow 驱动。",
  },
  architecture: {
    label: "架构",
    icon: Blocks,
    description: "架构工作流：技术选型、系统设计、数据模型设计等，由专门的架构 Workflow 驱动。",
  },
  build: {
    label: "构建",
    icon: Rocket,
    description: "构建工作流：任务拆解、开发计划、里程碑跟踪等，由专门的构建 Workflow 驱动。",
  },
  knowledge: {
    label: "项目知识",
    icon: BookOpen,
    description: "项目知识库：沉淀项目事实、约束与背景信息，供 AI 总管和各专业工作流共享引用。",
  },
} as const;

type SectionKey = keyof typeof SECTIONS;

export const Route = createFileRoute("/_authenticated/projects/$projectId/$section")({
  head: () => ({
    meta: [
      { title: "项目工作区 · AI 项目总管" },
      {
        name: "description",
        content: "项目内的研究、产品、架构、构建与项目知识工作区。",
      },
      { property: "og:title", content: "项目工作区 · AI 项目总管" },
      {
        property: "og:description",
        content: "项目内的研究、产品、架构、构建与项目知识工作区。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProjectSectionPage,
});

function ProjectSectionPage() {
  const { projectId, section } = useParams({
    from: "/_authenticated/projects/$projectId/$section",
  });
  const config = SECTIONS[section as SectionKey];

  if (!config) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">未知的项目板块。</p>
      </div>
    );
  }

  if (section === "knowledge") {
    return <KnowledgePanel projectId={projectId} />;
  }

  const Icon = config.icon;
  const connected = isWorkflowConnected(section as WorkflowKey);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-border bg-secondary">
          <Icon className="size-5 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">{config.label}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{config.description}</p>
        <p className="mt-4 inline-block rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          {connected ? "工作流已接入。" : "工作流尚未接入，接入后结果会在这里展示。"}
        </p>
        <div className="mt-6">
          <Link
            to="/projects/$projectId/chat"
            params={{ projectId }}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <MessageSquareText className="size-4" />
            先通过 AI 总管对话推进这一板块
          </Link>
        </div>
      </div>
    </div>
  );
}

function KnowledgePanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const { data: facts = [] } = useQuery({
    queryKey: ["facts", projectId],
    queryFn: () => listProjectFacts({ data: { projectId } }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["facts", projectId] });

  const saveMutation = useMutation({
    mutationFn: () => upsertProjectFact({ data: { projectId, key: key.trim(), value } }),
    onSuccess: () => {
      setKey("");
      setValue("");
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (factId: string) => deleteProjectFact({ data: { factId } }),
    onSuccess: invalidate,
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <h2 className="text-lg font-semibold">项目知识</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        以「键 / 值」形式沉淀项目事实，供 AI 总管和未来的专业工作流共享引用。
      </p>

      <form
        className="mt-5 flex flex-col gap-2 rounded-xl border border-border bg-card p-4 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) saveMutation.mutate();
        }}
      >
        <Input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="事实名称，例如「目标用户」"
          className="sm:w-56"
        />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="内容"
          className="flex-1"
        />
        <Button type="submit" size="sm" disabled={!key.trim()}>
          <Plus /> 保存
        </Button>
      </form>

      <ul className="mt-4 space-y-2">
        {facts.length === 0 && (
          <li className="text-sm text-muted-foreground">还没有记录任何项目知识。</li>
        )}
        {facts.map((fact) => (
          <li
            key={fact.id}
            className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm"
          >
            <span className="w-40 shrink-0 text-muted-foreground">{fact.key}</span>
            <span className="flex-1 whitespace-pre-wrap">{fact.value}</span>
            <button
              onClick={() => removeMutation.mutate(fact.id)}
              className="text-muted-foreground transition-colors hover:text-destructive"
              aria-label="删除"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
