// AI Gateway error codes. Internal detail stays in the Error message (for
// server logs after sanitization); the client only ever sees `userMessage`.

export type GatewayErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "WORKFLOW_NOT_FOUND"
  | "WORKFLOW_DISABLED"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_DISABLED"
  | "PROVIDER_NOT_CONFIGURED"
  | "SECRET_NOT_CONFIGURED"
  | "DIFY_REQUEST_FAILED"
  | "DIFY_TIMEOUT"
  | "DIFY_RESPONSE_INVALID"
  | "MODEL_NOT_FOUND"
  | "MODEL_DISABLED"
  | "SKILL_NOT_FOUND"
  | "SKILL_DISABLED"
  | "DIRECT_MODEL_REQUEST_FAILED"
  | "DIRECT_MODEL_TIMEOUT"
  | "DIRECT_MODEL_RESPONSE_INVALID";

const META: Record<GatewayErrorCode, { status: number; message: string }> = {
  AUTH_REQUIRED: { status: 401, message: "请先登录。" },
  FORBIDDEN: { status: 403, message: "无权访问该资源。" },
  WORKFLOW_NOT_FOUND: { status: 404, message: "未找到对应的 AI 工作流。" },
  WORKFLOW_DISABLED: { status: 409, message: "该 AI 工作流已停用。" },
  PROVIDER_NOT_FOUND: { status: 404, message: "未找到该工作流对应的服务提供方。" },
  PROVIDER_DISABLED: { status: 409, message: "该服务提供方已停用。" },
  PROVIDER_NOT_CONFIGURED: { status: 503, message: "该服务提供方尚未配置地址。" },
  SECRET_NOT_CONFIGURED: { status: 503, message: "该工作流尚未配置可用的密钥。" },
  DIFY_REQUEST_FAILED: { status: 502, message: "AI 服务请求失败，请稍后重试。" },
  DIFY_TIMEOUT: { status: 504, message: "AI 服务响应超时，请重试。" },
  DIFY_RESPONSE_INVALID: { status: 502, message: "AI 服务返回了无法解析的响应。" },
  MODEL_NOT_FOUND: { status: 404, message: "未找到对应的模型。" },
  MODEL_DISABLED: { status: 409, message: "该模型已停用。" },
  SKILL_NOT_FOUND: { status: 404, message: "未找到对应的技能。" },
  SKILL_DISABLED: { status: 409, message: "该技能已停用。" },
  DIRECT_MODEL_REQUEST_FAILED: { status: 502, message: "模型服务请求失败，请稍后重试。" },
  DIRECT_MODEL_TIMEOUT: { status: 504, message: "模型服务响应超时，请重试。" },
  DIRECT_MODEL_RESPONSE_INVALID: { status: 502, message: "模型服务返回了无法解析的响应。" },
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
