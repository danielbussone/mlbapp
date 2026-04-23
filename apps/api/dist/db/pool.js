import pg from 'pg';
let pool = null;
export function getPool() {
    const url = process.env.DATABASE_URL;
    if (!url || !url.trim()) {
        throw new Error('DATABASE_URL is not set');
    }
    if (!pool) {
        pool = new pg.Pool({ connectionString: url, max: 10 });
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
