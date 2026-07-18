import { readFileSync } from 'node:fs';
import pg from 'pg';
import { getChatQueryLog } from './chatQueryLogContext.js';

let pool: pg.Pool | null = null;

/** Read the RDS/Aurora CA bundle from DATABASE_SSL_CA (inline PEM or a file path). */
function readCaBundle(): string | undefined {
  const raw = process.env.DATABASE_SSL_CA;
  if (!raw || !raw.trim()) return undefined;
  const v = raw.trim();
  if (v.includes('BEGIN CERTIFICATE')) return v;
  try {
    return readFileSync(v, 'utf8');
  } catch (e) {
    throw new Error(
      `DATABASE_SSL_CA could not be read as a file path: ${v} (${e instanceof Error ? e.message : String(e)})`
    );
  }
}

/**
 * TLS config for the pool, from DATABASE_SSL. Managed Postgres (Aurora/RDS) enforces TLS, but
 * node-postgres does not infer it from the URL reliably, so we set it explicitly.
 * - unset | disable | off | false → no TLS (local Docker Postgres).
 * - require | no-verify | on | true → encrypt without CA verification (simplest for Aurora in-VPC).
 * - verify-full | verify-ca → encrypt AND verify against DATABASE_SSL_CA (the RDS CA bundle).
 */
export function resolvePoolSsl(): pg.PoolConfig['ssl'] {
  const mode = (process.env.DATABASE_SSL ?? '').trim().toLowerCase();
  if (mode === '' || mode === 'disable' || mode === 'off' || mode === 'false') return undefined;
  if (mode === 'require' || mode === 'no-verify' || mode === 'on' || mode === 'true') {
    return { rejectUnauthorized: false };
  }
  if (mode === 'verify-full' || mode === 'verify-ca') {
    const ca = readCaBundle();
    if (!ca) {
      throw new Error(
        `DATABASE_SSL=${mode} requires the RDS CA bundle: set DATABASE_SSL_CA to its file path or PEM contents ` +
          '(download from https://truststore.pki.rds.amazonaws.com/).'
      );
    }
    return { rejectUnauthorized: true, ca };
  }
  throw new Error(`Unknown DATABASE_SSL="${mode}" (use disable | require | verify-full).`);
}

function sqlOneLine(text: string, max: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

function chatDbLogDisabled(): boolean {
  return String(process.env.CHAT_LOG_DB ?? '').toLowerCase() === 'off';
}

function dbParamsLogLimit(): number {
  const raw = process.env.CHAT_LOG_DB_PARAMS_MAX;
  if (raw === undefined || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(40, Math.floor(n));
}

function dbRowPreviewCount(): number {
  const raw = process.env.CHAT_LOG_DB_ROWS;
  if (raw === undefined || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(15, Math.floor(n));
}

function clipJson(obj: unknown, max: number): string {
  try {
    const s = JSON.stringify(obj);
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return '[unserializable]';
  }
}

function attachChatQueryLogger(p: pg.Pool): void {
  if ((p as unknown as { __mlbapp_chatQueryLog?: boolean }).__mlbapp_chatQueryLog) return;
  (p as unknown as { __mlbapp_chatQueryLog: boolean }).__mlbapp_chatQueryLog = true;

  const orig = p.query.bind(p) as (...args: unknown[]) => unknown;
  (p as unknown as { query: typeof orig }).query = function (...args: unknown[]) {
    const last = args[args.length - 1];
    if (typeof last === 'function') {
      return orig(...args);
    }
    const first = args[0];
    if (first && typeof first === 'object' && 'submit' in first) {
      return orig(...args);
    }

    let text = '';
    let values: unknown[] | undefined;
    if (typeof first === 'string') {
      text = first;
      values = args[1] as unknown[] | undefined;
    } else if (first && typeof first === 'object' && 'text' in first) {
      const q = first as { text: string; values?: unknown[] };
      text = q.text;
      values = q.values;
    } else {
      return orig(...args);
    }

    const log = chatDbLogDisabled() ? undefined : getChatQueryLog();
    const t0 = Date.now();
    const out = orig(...args);
    if (!log || out == null || typeof (out as Promise<unknown>).then !== 'function') {
      return out;
    }

    return (out as Promise<pg.QueryResult>).then(
      (res) => {
        const durationMs = Date.now() - t0;
        const paramLimit = dbParamsLogLimit();
        const rowN = dbRowPreviewCount();
        const payload: Record<string, unknown> = {
          step: 'db_query',
          sqlPreview: sqlOneLine(text, 700),
          paramCount: values?.length ?? 0,
          rowCount: res.rowCount,
          fieldCount: res.fields?.length ?? 0,
          durationMs,
        };
        if (paramLimit > 0 && values?.length) {
          payload.params = values.slice(0, paramLimit).map((v, i) => ({
            i,
            kind: v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v,
            preview: clipJson(v, 120),
          }));
        }
        if (rowN > 0 && res.rows?.length) {
          payload.rowPreview = res.rows.slice(0, rowN).map((row) => clipJson(row, 800));
        }
        if (res.rows?.length && res.rows[0]) {
          payload.firstRowKeys = Object.keys(res.rows[0] as object).slice(0, 60);
        }
        log.info(payload, 'chat postgres query completed');
        return res;
      },
      (err: unknown) => {
        log.info(
          {
            step: 'db_query_error',
            sqlPreview: sqlOneLine(text, 700),
            paramCount: values?.length ?? 0,
            durationMs: Date.now() - t0,
            err: err instanceof Error ? err.message : String(err),
          },
          'chat postgres query failed'
        );
        throw err;
      }
    );
  };
}

export function getPool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url || !url.trim()) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!pool) {
    const ssl = resolvePoolSsl();
    const p = new pg.Pool({ connectionString: url, max: 10, ...(ssl ? { ssl } : {}) });
    attachChatQueryLogger(p);
    pool = p;
  }
  return pool;
}

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
