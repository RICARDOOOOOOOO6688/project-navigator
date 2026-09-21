import { createFileRoute } from "@tanstack/react-router";

// Safe configuration diagnostic: reports ONLY whether the Dify credentials
// exist. The key itself is never read into the response.
export const Route = createFileRoute("/api/dify-status")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env["DIFY_API_KEY"];
        const base =
          process.env["DIFY_API_BASE"] ?? process.env["DIFY_API_URL"] ?? "https://api.dify.ai/v1";
        return new Response(
          JSON.stringify({
            configured: Boolean(key && key.trim()),
            keyVar: "DIFY_API_KEY",
            baseVar: "DIFY_API_BASE",
            // base URL is not a secret; helps confirm self-hosted endpoints
            endpoint: `${base.replace(/\/+$/, "")}/chat-messages`,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          },
        );
      },
    },
  },
});
