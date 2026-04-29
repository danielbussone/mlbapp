import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';

/** Absolute or repo-relative directory; unset disables persistence. */
export function chatToolTraceDir(): string | null {
  const d = process.env.CHAT_TOOL_TRACE_DIR?.trim();
  if (!d) return null;
  return isAbsolute(d) ? d : resolve(process.cwd(), d);
}

export type ChatToolTraceRecord = {
  traceId?: string;
  tool: string;
  source:
    | 'model'
    | 'server_fg_fallback'
    | 'server_compare_inject'
    | 'server_resolve_inject'
    | 'server_active_resolve'
    | 'server_statcast_inject';
  args: unknown;
  /** Exact JSON string appended as `role: tool` content for Ollama. */
  resultJson: string;
  userMessagePreview?: string;
};

/**
 * Writes one JSON file per tool invocation (full I/O, not SSE-truncated).
 * Swallows errors so chat never fails if the trace dir is missing or unwritable.
 */
export function persistChatToolTrace(record: ChatToolTraceRecord): string | null {
  const dir = chatToolTraceDir();
  if (!dir) return null;

  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return null;
  }

  const id = record.traceId && record.traceId.length > 0 ? sanitizeFilePart(record.traceId) : 'no-req-id';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const nonce = randomBytes(4).toString('hex');
  const tool = sanitizeFilePart(record.tool);
  const filename = `${stamp}_${id}_${tool}_${nonce}.json`;
  const filepath = resolve(dir, filename);

  let resultParsed: unknown;
  try {
    resultParsed = JSON.parse(record.resultJson) as unknown;
  } catch {
    resultParsed = { _parse_error: true, _raw: record.resultJson };
  }

  const payload = {
    writtenAt: new Date().toISOString(),
    traceId: record.traceId ?? null,
    tool: record.tool,
    source: record.source,
    userMessagePreview: record.userMessagePreview,
    args: record.args,
    resultJson: record.resultJson,
    resultParsed,
    resultChars: record.resultJson.length,
  };

  try {
    writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf8');
    return filepath;
  } catch {
    return null;
  }
}

function sanitizeFilePart(s: string): string {
  return s.replace(/[^\w.-]+/g, '_').slice(0, 120);
}
