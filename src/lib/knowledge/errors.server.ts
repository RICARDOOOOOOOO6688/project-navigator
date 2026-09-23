// Knowledge-specific errors. Deliberately separate from the Dify/Gateway error
// codes — this layer must be usable without any knowledge of Dify.

export type KnowledgeErrorCode =
  | "KNOWLEDGE_PROVIDER_NOT_CONFIGURED"
  | "KNOWLEDGE_PROVIDER_UNSUPPORTED"
  | "KNOWLEDGE_REQUEST_FAILED"
  | "KNOWLEDGE_TIMEOUT"
  | "KNOWLEDGE_RESPONSE_INVALID";

const MESSAGES: Record<KnowledgeErrorCode, string> = {
  KNOWLEDGE_PROVIDER_NOT_CONFIGURED: "知识库提供方尚未配置。",
  KNOWLEDGE_PROVIDER_UNSUPPORTED: "不支持的知识库提供方配置。",
  KNOWLEDGE_REQUEST_FAILED: "知识库请求失败，请稍后重试。",
  KNOWLEDGE_TIMEOUT: "知识库请求超时，请重试。",
  KNOWLEDGE_RESPONSE_INVALID: "知识库返回了无法解析的响应。",
};

export class KnowledgeError extends Error {
  readonly code: KnowledgeErrorCode;
  readonly userMessage: string;

  constructor(code: KnowledgeErrorCode, detail?: string, cause?: unknown) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "KnowledgeError";
    this.code = code;
    this.userMessage = MESSAGES[code];
    if (cause !== undefined) this.cause = cause;
  }
}

export function isKnowledgeError(value: unknown): value is KnowledgeError {
  return value instanceof KnowledgeError;
}
