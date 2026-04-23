import { Agent, fetch as undiciFetch } from 'undici';
import { getNodeProcessMemoryMb } from '../lib/processMemory.js';

const OLLAMA_HOST = (process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/$/, '');

const ollamaProbeDispatcher = new Agent({
  headersTimeout: 8_000,
  bodyTimeout: 8_000,
  connectTimeout: 5_000,
});

export type OllamaRunningModelSummary = {
  name: string;
  model?: string;
  /** Resident / weights size (Ollama field is bytes). */
  size_gb: number;
  /** GPU VRAM in use when applicable (bytes from API → GiB). */
  size_vram_gb: number;
  context_length?: number;
  expires_at?: string;
};

export type OllamaHealthResult = {
  ok: boolean;
  ollamaHost: string;
  configuredModel?: string;
  tagsHttpStatus?: number;
  tagsLatencyMs?: number;
  modelCount?: number;
  tagsError?: string;
  /** `GET /api/ps` — models loaded in Ollama (RAM/VRAM pressure). */
  psLatencyMs?: number;
  psHttpStatus?: number;
  psError?: string;
  runningModels?: OllamaRunningModelSummary[];
  /** This Node process (API); Ollama is separate. */
  apiProcessMemoryMb?: Record<string, number>;
  error?: string;
};

function bytesToGiB(n: number): number {
  return Math.round((n / 1024 ** 3) * 100) / 100;
}

function summarizeRunningModel(m: Record<string, unknown>): OllamaRunningModelSummary {
  const size = typeof m.size === 'number' ? m.size : 0;
  const vram = typeof m.size_vram === 'number' ? m.size_vram : 0;
  return {
    name: String(m.name ?? m.model ?? ''),
    model: m.model != null ? String(m.model) : undefined,
    size_gb: bytesToGiB(size),
    size_vram_gb: bytesToGiB(vram),
    context_length: typeof m.context_length === 'number' ? m.context_length : undefined,
    expires_at: typeof m.expires_at === 'string' ? m.expires_at : undefined,
  };
}

async function probeTags(): Promise<{
  ok: boolean;
  status?: number;
  latencyMs: number;
  modelCount?: number;
  error?: string;
}> {
  const t0 = Date.now();
  try {
    const r = await undiciFetch(`${OLLAMA_HOST}/api/tags`, {
      method: 'GET',
      dispatcher: ollamaProbeDispatcher,
    });
    const latencyMs = Date.now() - t0;
    if (!r.ok) {
      return { ok: false, status: r.status, latencyMs, error: `Ollama /api/tags HTTP ${r.status}` };
    }
    const j = (await r.json()) as { models?: unknown[] };
    const modelCount = Array.isArray(j.models) ? j.models.length : 0;
    return { ok: true, status: r.status, latencyMs, modelCount };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function probePs(): Promise<{
  ok: boolean;
  status?: number;
  latencyMs: number;
  models?: OllamaRunningModelSummary[];
  error?: string;
}> {
  const t0 = Date.now();
  try {
    const r = await undiciFetch(`${OLLAMA_HOST}/api/ps`, {
      method: 'GET',
      dispatcher: ollamaProbeDispatcher,
    });
    const latencyMs = Date.now() - t0;
    if (!r.ok) {
      return { ok: false, status: r.status, latencyMs, error: `Ollama /api/ps HTTP ${r.status}` };
    }
    const j = (await r.json()) as { models?: unknown[] };
    const raw = Array.isArray(j.models) ? j.models : [];
    const models = raw
      .filter((x): x is Record<string, unknown> => x != null && typeof x === 'object' && !Array.isArray(x))
      .map(summarizeRunningModel);
    return { ok: true, status: r.status, latencyMs, models };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Probes Ollama: `/api/tags` (daemon + catalog), `/api/ps` (loaded models, VRAM, context).
 * Includes this API process RSS/heap snapshot (`apiProcessMemoryMb`) — not Ollama's RAM.
 */
export async function getOllamaHealth(): Promise<OllamaHealthResult> {
  const configuredModel = process.env.OLLAMA_MODEL ?? 'llama3.2';
  const apiProcessMemoryMb = getNodeProcessMemoryMb();

  const [tags, ps] = await Promise.all([probeTags(), probePs()]);

  return {
    ok: tags.ok,
    ollamaHost: OLLAMA_HOST,
    configuredModel,
    tagsHttpStatus: tags.status,
    tagsLatencyMs: tags.latencyMs,
    modelCount: tags.modelCount,
    tagsError: tags.ok ? undefined : tags.error,
    psLatencyMs: ps.latencyMs,
    psHttpStatus: ps.status,
    psError: ps.ok ? undefined : ps.error,
    runningModels: ps.models,
    apiProcessMemoryMb,
    error: tags.ok ? undefined : tags.error,
  };
}
