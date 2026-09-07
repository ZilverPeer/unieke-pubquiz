/**
 * Orchestrator tool: show what a background subagent has been doing.
 *
 * Reads the subagent's Claude Code transcript (JSONL) and prints its last N
 * assistant texts, tool calls, and tool results, truncated. Used by the
 * 30-minute check-in rule in docs/agents/orchestration.md. Never edits
 * anything.
 *
 *   npx tsx scripts/agents/peek.ts <agentId> [count=15]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [agentId, countArg] = process.argv.slice(2);
if (!agentId) {
  console.error("usage: npx tsx scripts/agents/peek.ts <agentId> [count]");
  process.exit(2);
}
const count = Number(countArg ?? 15);

// Claude Code names the project dir by replacing every ":", "\" and "/" in the cwd with "-".
const projectSlug = process.cwd().replace(/[:/\\]/g, "-");
const projectDir = join(homedir(), ".claude", "projects", projectSlug);

function findTranscript(dir: string): string | undefined {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const found = findTranscript(full);
      if (found) return found;
    } else if (entry === `agent-${agentId}.jsonl`) {
      return full;
    }
  }
  return undefined;
}

const transcript = findTranscript(projectDir);
if (!transcript) {
  console.error(`no transcript for agent ${agentId} under ${projectDir}`);
  process.exit(1);
}

const clip = (s: string, n: number) => s.replace(/\s+/g, " ").slice(0, n);
const lines: string[] = [];
for (const raw of readFileSync(transcript, "utf8").split("\n")) {
  if (!raw.trim()) continue;
  const row = JSON.parse(raw);
  const content = row.message?.content;
  if (!Array.isArray(content)) continue;
  const at = (row.timestamp ?? "").slice(11, 19);
  for (const block of content) {
    if (row.type === "assistant" && block.type === "text") lines.push(`${at} TEXT   ${clip(block.text, 400)}`);
    if (row.type === "assistant" && block.type === "tool_use")
      lines.push(`${at} CALL   ${block.name} ${clip(JSON.stringify(block.input), 300)}`);
    if (row.type === "user" && block.type === "tool_result") {
      const body = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
      lines.push(`${at} RESULT ${clip(body.slice(-500), 300)}`);
    }
  }
}
const started = statSync(transcript).birthtime;
console.log(`transcript: ${transcript}\nstarted: ${started.toISOString()}  entries: ${lines.length}\n`);
console.log(lines.slice(-count).join("\n"));
