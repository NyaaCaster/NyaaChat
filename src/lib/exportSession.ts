import { ChatSession } from "../types";

/**
 * Render a session as a self-contained Markdown document. Used for the
 * "export as .md" action so users can paste the conversation into other
 * tools (Obsidian, GitHub, etc.) without losing structure.
 */
export function sessionToMarkdown(session: ChatSession): string {
  const lines: string[] = [];
  const created = new Date(session.createdAt);
  lines.push(`# ${session.characterName}`);
  lines.push("");
  lines.push(`> 创建于 ${created.toLocaleString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const m of session.messages) {
    if (m.role === "system") continue;
    const ts = m.timestamp
      ? ` _${new Date(m.timestamp).toLocaleString()}_`
      : "";
    const heading = m.role === "user" ? "User" : session.characterName;
    lines.push(`### ${heading}${ts}`);
    lines.push("");
    lines.push(m.content);
    if (m.memoryBatchSeq !== undefined) {
      lines.push(`> ── 记忆分界 #${m.memoryBatchSeq} ──`);
      lines.push("");
    }
    lines.push("");
  }

  return lines.join("\n");
}
