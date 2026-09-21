import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Lightbulb,
  Search,
  FolderKanban,
  Blocks,
  Rocket,
  Plus,
  Trash2,
  LogOut,
  Menu,
  X,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  STAGES,
  createThread,
  deleteThread,
  getThreadMessages,
  listThreads,
  updateThreadStage,
  type ChatMessage,
  type StageId,
  type Thread,
} from "@/lib/threads.functions";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_MODEL_KEY, MODEL_CATALOG, isModelKey, type ModelKey } from "@/lib/models";
import logo from "@/assets/logo.png";

const STAGE_ICONS = {
  idea: Lightbulb,
  research: Search,
  project: FolderKanban,
  architecture: Blocks,
  build: Rocket,
} as const;

type SendState =
  | { status: "idle" }
  | { status: "submitted"; userText: string }
  | { status: "streaming"; userText: string; assistantText: string }
  | { status: "error"; userText: string; message: string };

export function ProjectChatWorkspace({
  threadId,
  hideSidebar = false,
}: {
  threadId: string;
  hideSidebar?: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sendState, setSendState] = useState<SendState>({ status: "idle" });
  const [modelKey, setModelKey] = useState<ModelKey>(DEFAULT_MODEL_KEY);
  const abortRef = useRef<AbortController | null>(null);

  const { data: threads = [] } = useQuery({
    queryKey: ["threads"],
    queryFn: () => listThreads(),
  });

  const activeThread: Thread | undefined = threads.find((t) => t.id === threadId);

  const { data: messages = [] } = useQuery({
    queryKey: ["messages", threadId],
    queryFn: () => getThreadMessages({ data: { threadId } }),
    enabled: !!threadId,
  });

  // Safe config diagnostic: returns only booleans / the non-secret base URL.
  const { data: difyStatus } = useQuery({
    queryKey: ["dify-status"],
    queryFn: async () =>
      (await fetch("/api/dify-status")).json() as Promise<{
        configured: boolean;
        keyVar: string;
        baseVar: string;
        endpoint: string;
      }>,
    staleTime: 60_000,
  });
  const difyMissing = difyStatus?.configured === false;

  const stageMutation = useMutation({
    mutationFn: (stage: StageId) => updateThreadStage({ data: { threadId, stage } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["threads"] }),
  });

  // Abort any in-flight stream when switching threads or unmounting.
  useEffect(() => {
    setSendState({ status: "idle" });
    return () => abortRef.current?.abort();
  }, [threadId]);

  const handleNewThread = async () => {
    const thread = await createThread({ data: { title: "新项目" } });
    await queryClient.invalidateQueries({ queryKey: ["threads"] });
    setSidebarOpen(false);
    navigate({ to: "/chat/$threadId", params: { threadId: thread.id } });
  };

  const handleDeleteThread = async (id: string) => {
    await deleteThread({ data: { id } });
    await queryClient.invalidateQueries({ queryKey: ["threads"] });
    if (id === threadId) navigate({ to: "/chat" });
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const handleSubmit = async ({ text }: PromptInputMessage) => {
    const trimmed = text.trim();
    if (!trimmed || sendState.status !== "idle") return;

    setSendState({ status: "submitted", userText: trimmed });
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ threadId, message: trimmed, model: modelKey }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        // The gateway returns safe { code, message } JSON for all failures.
        const payload = (await res.json().catch(() => null)) as {
          code?: string;
          message?: string;
        } | null;
        const message = payload?.message ?? `请求失败（${res.status}）`;
        setSendState({ status: "error", userText: trimmed, message });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      setSendState({ status: "streaming", userText: trimmed, assistantText: "" });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        setSendState({ status: "streaming", userText: trimmed, assistantText });
      }

      await queryClient.invalidateQueries({ queryKey: ["messages", threadId] });
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
      setSendState({ status: "idle" });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setSendState({ status: "idle" });
        return;
      }
      setSendState({
        status: "error",
        userText: trimmed,
        message: "网络异常，请稍后重试。",
      });
    }
  };

  const sending = sendState.status !== "idle";
  const stageIndex = STAGES.findIndex((s) => s.id === (activeThread?.stage ?? "idea"));

  const sidebar = (
    <div className="flex h-full w-72 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-4">
        <img src={logo} alt="AI 项目总管" className="size-8" />
        <span className="text-base font-semibold tracking-tight text-sidebar-foreground">
          AI 项目总管
        </span>
        <button
          className="ml-auto text-muted-foreground hover:text-foreground md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="关闭菜单"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="p-3">
        <Button onClick={handleNewThread} className="w-full" size="sm">
          <Plus /> 新建项目
        </Button>
      </div>

      <div className="border-b border-sidebar-border px-4 pb-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          项目阶段
        </p>
        <ol className="space-y-1">
          {STAGES.map((stage, i) => {
            const Icon = STAGE_ICONS[stage.id];
            const isCurrent = i === stageIndex;
            const isDone = i < stageIndex;
            return (
              <li key={stage.id} className="relative">
                {i < STAGES.length - 1 && (
                  <span
                    className={cn(
                      "absolute top-8 left-[15px] h-[calc(100%-24px)] w-px",
                      isDone ? "bg-primary/50" : "bg-border",
                    )}
                  />
                )}
                <button
                  onClick={() => stageMutation.mutate(stage.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left text-sm transition-colors",
                    isCurrent
                      ? "text-primary"
                      : isDone
                        ? "text-foreground/80 hover:text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full border",
                      isCurrent
                        ? "border-primary bg-primary/15 text-primary"
                        : isDone
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-secondary text-muted-foreground",
                    )}
                  >
                    {isDone ? <Check className="size-4" /> : <Icon className="size-4" />}
                  </span>
                  <span className={cn(isCurrent && "font-medium")}>{stage.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin-dark">
        <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          我的对话
        </p>
        <div className="space-y-1">
          {threads.map((thread) => (
            <div
              key={thread.id}
              className={cn(
                "group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors",
                thread.id === threadId
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )}
            >
              <button
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => {
                  setSidebarOpen(false);
                  navigate({
                    to: "/chat/$threadId",
                    params: { threadId: thread.id },
                  });
                }}
              >
                {thread.title}
              </button>
              <button
                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                onClick={() => handleDeleteThread(thread.id)}
                aria-label="删除对话"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-sidebar-border p-3">
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <LogOut className="size-4" /> 退出登录
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden md:block">{sidebar}</aside>
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute inset-y-0 left-0">{sidebar}</div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <button
            className="text-muted-foreground hover:text-foreground md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="打开菜单"
          >
            <Menu className="size-5" />
          </button>
          <h1 className="truncate text-sm font-medium">{activeThread?.title ?? "新项目"}</h1>
          <span className="ml-auto shrink-0 rounded-full border border-primary/30 bg-primary/10 px-3 py-0.5 text-xs text-primary">
            {STAGES[stageIndex]?.label ?? "想法"}
          </span>
        </header>

        {difyMissing && (
          <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-center text-xs text-destructive">
            尚未配置 Dify Agent 密钥，AI 暂时无法回复。请在「项目设置 → Secrets」中添加{" "}
            <code className="font-mono">DIFY_API_KEY</code>
            （私有部署再加 <code className="font-mono">DIFY_API_BASE</code>）。
          </div>
        )}

        <Conversation className="flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-6">
            {messages.length === 0 && sendState.status === "idle" ? (
              <ConversationEmptyState
                icon={<img src={logo} alt="" className="size-16 opacity-90" />}
                title="开始你的项目对话"
                description="输入你的创业或竞赛想法，AI Agent 会陪你一步步完成调研、设计与构建。"
              />
            ) : (
              <>
                {messages.map((msg: ChatMessage) => (
                  <Message key={msg.id} from={msg.role}>
                    <MessageContent>
                      {msg.role === "assistant" ? (
                        <MessageResponse>{msg.content}</MessageResponse>
                      ) : (
                        msg.content
                      )}
                    </MessageContent>
                  </Message>
                ))}
                {sendState.status !== "idle" && (
                  <Message from="user">
                    <MessageContent>{sendState.userText}</MessageContent>
                  </Message>
                )}
                {sendState.status === "submitted" && (
                  <Message from="assistant">
                    <MessageContent>
                      <Shimmer className="text-sm">正在思考…</Shimmer>
                    </MessageContent>
                  </Message>
                )}
                {sendState.status === "streaming" && (
                  <Message from="assistant">
                    <MessageContent>
                      {sendState.assistantText ? (
                        <MessageResponse>{sendState.assistantText}</MessageResponse>
                      ) : (
                        <Shimmer className="text-sm">正在思考…</Shimmer>
                      )}
                    </MessageContent>
                  </Message>
                )}
                {sendState.status === "error" && (
                  <Message from="assistant">
                    <MessageContent>
                      <p className="text-destructive">{sendState.message}</p>
                    </MessageContent>
                  </Message>
                )}
              </>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t border-border bg-background/80 px-4 py-3 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl">
            <PromptInput onSubmit={handleSubmit}>
              <PromptInputTextarea
                placeholder="描述你的想法，或继续推进当前阶段…"
                disabled={sending}
                autoFocus
              />
              <PromptInputFooter className="justify-between">
                <Select
                  value={modelKey}
                  onValueChange={(v) => {
                    if (isModelKey(v)) setModelKey(v);
                  }}
                >
                  <SelectTrigger
                    className="h-8 w-auto min-w-40 border-border bg-secondary/60 text-xs"
                    aria-label="选择模型"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_CATALOG.map((m) => (
                      <SelectItem key={m.key} value={m.key} disabled={m.status !== "enabled"}>
                        <span className="flex items-center gap-2">
                          <span>{m.label}</span>
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px]",
                              m.status === "enabled"
                                ? "bg-primary/15 text-primary"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {m.status === "enabled" ? "已启用" : "未启用"}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <PromptInputSubmit
                  {...(sendState.status === "submitted" || sendState.status === "streaming"
                    ? { status: sendState.status }
                    : {})}
                  onStop={() => abortRef.current?.abort()}
                  disabled={sendState.status === "error"}
                />
              </PromptInputFooter>
            </PromptInput>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {difyStatus?.configured
                ? "由你的 Dify Agent 驱动 · 左侧可切换项目阶段"
                : "Dify Agent 状态：未配置"}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
