# 任务清单

## 已完成

- [x] Project OS 第一阶段：projects/tasks/decisions/project_facts + RLS + ownership 校验 + 项目页导航/总览/占位页
- [x] Dify 回复链路诊断：/api/dify-status、错误提示、SSE 解析加固（等用户配置 DIFY_API_KEY）
- [x] 账号系统第一阶段：邮箱+密码、Google、手机号+密码（无短信，服务端映射）；自测通过
- [x] phone-auth.functions.ts 改用 .validator()，注册错误服务端日志

## 待办

- [ ] 用户在项目设置 → Secrets 配置 DIFY_API_KEY（app- 开头），私有部署加 DIFY_API_BASE
- [ ] 清理测试手机号账号 13900001111（如需要，需管理员删除 auth 用户）
- [ ] AI 总管自动把对话中的任务/决策沉淀到总览页
- [ ] 接入 research/product/architecture/build 四个 Dify 工作流（注册到 workflows.ts REGISTRY）
- [ ] 其余 serverFn 的 inputValidator → .validator() 迁移（仅警告，不影响功能）
- [ ] 手机号账号补绑邮箱 / 找回密码能力（后续阶段）
