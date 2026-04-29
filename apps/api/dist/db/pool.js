import pg from 'pg';
import { getChatQueryLog } from './chatQueryLogContext.js';
let pool = null;
function sqlOneLine(text, max) {
    return text.replace(/\s+/g, ' ').trim().slice(0, max);
}
function chatDbLogDisabled() {
    return String(process.env.CHAT_LOG_DB ?? '').toLowerCase() === 'off';
}
function dbParamsLogLimit() {
    const raw = process.env.CHAT_LOG_DB_PARAMS_MAX;
    if (raw === undefined || raw === '')
        return 0;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0)
        return 0;
    return Math.min(40, Math.floor(n));
}
function dbRowPreviewCount() {
    const raw = process.env.CHAT_LOG_DB_ROWS;
    if (raw === undefined || raw === '')
        return 0;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0)
        return 0;
    return Math.min(15, Math.floor(n));
}
function clipJson(obj, max) {
    try {
        const s = JSON.stringify(obj);
        return s.length > max ? s.slice(0, max) + '…' : s;
    }
    catch {
        return '[unserializable]';
    }
}
function attachChatQueryLogger(p) {
    if (p.__mlbapp_chatQueryLog)
        return;
    p.__mlbapp_chatQueryLog = true;
    const orig = p.query.bind(p);
    p.query = function (...args) {
        const last = args[args.length - 1];
        if (typeof last === 'function') {
            return orig(...args);
        }
        const first = args[0];
        if (first && typeof first === 'object' && 'submit' in first) {
            return orig(...args);
        }
        let text = '';
        let values;
        if (typeof first === 'string') {
            text = first;
            values = args[1];
        }
        else if (first && typeof first === 'object' && 'text' in first) {
            const q = first;
            text = q.text;
            values = q.values;
        }
        else {
            return orig(...args);
        }
        const log = chatDbLogDisabled() ? undefined : getChatQueryLog();
        const t0 = Date.now();
        const out = orig(...args);
        if (!log || out == null || typeof out.then !== 'function') {
            return out;
        }
        return out.then((res) => {
            const durationMs = Date.now() - t0;
            const paramLimit = dbParamsLogLimit();
            const rowN = dbRowPreviewCount();
            const payload = {
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
                payload.firstRowKeys = Object.keys(res.rows[0]).slice(0, 60);
            }
            log.info(payload, 'chat postgres query completed');
            return res;
        }, (err) => {
            log.info({
                step: 'db_query_error',
                sqlPreview: sqlOneLine(text, 700),
                paramCount: values?.length ?? 0,
                durationMs: Date.now() - t0,
                err: err instanceof Error ? err.message : String(err),
            }, 'chat postgres query failed');
            throw err;
        });
    };
}
export function getPool() {
    const url = process.env.DATABASE_URL;
    if (!url || !url.trim()) {
        throw new Error('DATABASE_URL is not set');
    }
    if (!pool) {
        const p = new pg.Pool({ connectionString: url, max: 10 });
        attachChatQueryLogger(p);
        pool = p;
    }
    return pool;
}
export function hasDatabaseUrl() {
    return Boolean(process.env.DATABASE_URL?.trim());
}
export async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}
