// AI Gateway error codes. Internal detail stays in the Error message (for
// server logs after sanitization); the client only ever sees `userMessage`.

export type GatewayErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "WORKFLOW_NOT_FOUND"
  | "WORKFLOW_DISABLED"
  | "WORKFLOW_NOT_CONFIGURED"
  | "SECRET_NOT_CONFIGURED"
  | "QUOTA_EXCEEDED"
  | "DIFY_UNAVAILABLE"
  | "DIFY_TIMEOUT"
  | "DIFY_ERROR";

const META: Record<GatewayErrorCode, { status: number; message: string }> = {
  AUTH_REQUIRED: { status: 401, message: "请先登录。" },
  FORBIDDEN: { status: 403, message: "无权访问该资源。" },
  WORKFLOW_NOT_FOUND: { status: 404, message: "未找到对应的 AI 工作流。" },
  WORKFLOW_DISABLED: { status: 409, message: "该 AI 工作流已停用。" },
  WORKFLOW_NOT_CONFIGURED: { status: 503, message: "该工作流尚未配置完成。" },
  SECRET_NOT_CONFIGURED: { status: 503, message: "该工作流尚未配置可用的密钥。" },
  QUOTA_EXCEEDED: { status: 429, message: "已达到额度上限，请联系管理员。" },
  DIFY_UNAVAILABLE: { status: 502, message: "AI 服务暂时不可用，请稍后重试。" },
  DIFY_TIMEOUT: { status: 504, message: "AI 服务响应超时，请重试。" },
  DIFY_ERROR: { status: 502, message: "AI 服务返回错误，请重试。" },
};

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly httpStatus: number;
  readonly userMessage: string;

  constructor(code: GatewayErrorCode, detail?: string, cause?: unknown) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "GatewayError";
    this.code = code;
    this.httpStatus = META[code].status;
    this.userMessage = META[code].message;
    if (cause !== undefined) this.cause = cause;
  }
}

export function isGatewayError(value: unknown): value is GatewayError {
  return value instanceof GatewayError;
}
