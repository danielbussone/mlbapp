const VERSION = '0.0.1';
export function registerHealthRoute(app) {
    app.get('/health', async () => ({
        ok: true,
        service: 'mlbapp-api',
        version: VERSION,
    }));
}
