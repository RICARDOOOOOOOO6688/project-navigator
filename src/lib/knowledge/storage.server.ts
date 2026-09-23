// Server-safe helpers for user knowledge file storage.
//
// Objects always live under a per-user prefix so no user-controlled path can
// reach another user's files:
//   users/{user_id}/knowledge/{knowledge_space_id}/{document_id}/{filename}

export const KNOWLEDGE_BUCKET = "knowledge";

/** Strip any path components and unsafe characters from a filename. */
export function sanitizeKnowledgeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .replace(/[^\w.\-() \u4e00-\u9fa5]/g, "_")
    .trim()
    .slice(0, 200);
  return cleaned || "file";
}

export function buildKnowledgeStoragePath(input: {
  userId: string;
  spaceId: string;
  documentId: string;
  filename: string;
}): string {
  const safeName = sanitizeKnowledgeFilename(input.filename);
  return `users/${input.userId}/knowledge/${input.spaceId}/${input.documentId}/${safeName}`;
}

/** True only if `path` is inside the given user's knowledge prefix. */
export function isKnowledgePathOwnedBy(path: string, userId: string): boolean {
  return path.startsWith(`users/${userId}/knowledge/`) && !path.includes("..");
}
