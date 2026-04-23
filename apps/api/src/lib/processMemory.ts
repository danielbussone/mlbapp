/** RSS / V8 heap for the Fastify API process (not the Ollama daemon, which is separate). */
export function getNodeProcessMemoryMb(): Record<string, number> {
  const m = process.memoryUsage();
  const mb = (n: number) => Math.round((n / 1024 / 1024) * 100) / 100;
  return {
    rss_mb: mb(m.rss),
    heapTotal_mb: mb(m.heapTotal),
    heapUsed_mb: mb(m.heapUsed),
    external_mb: mb(m.external),
    arrayBuffers_mb: mb(m.arrayBuffers ?? 0),
  };
}
