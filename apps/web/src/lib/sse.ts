/** Parse Server-Sent Events from a fetch `Response` body (one JSON object per `data:` line). */
export async function consumeSse(
  response: Response,
  onEvent: (event: string, data: unknown) => void
): Promise<void> {
  if (!response.body) throw new Error('No response body');
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buffer = '';

  const dispatchBlock = (block: string) => {
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    const joined = dataLines.join('\n');
    let data: unknown = joined;
    try {
      data = joined ? JSON.parse(joined) : {};
    } catch {
      /* keep string */
    }
    onEvent(eventName, data);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, sep).trim();
      buffer = buffer.slice(sep + 2);
      if (block) dispatchBlock(block);
    }
  }
}
