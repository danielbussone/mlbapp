import { AsyncLocalStorage } from 'node:async_hooks';
import type { ChatStreamLogger } from '../lib/chatStreamLog.js';

type Store = { log: ChatStreamLogger };

const als = new AsyncLocalStorage<Store>();

export function getChatQueryLog(): ChatStreamLogger | undefined {
  return als.getStore()?.log;
}

/** Scope Postgres traffic during this async chain (e.g. one POST /chat). */
export async function runWithChatQueryLog<T>(
  log: ChatStreamLogger | undefined,
  fn: () => Promise<T>
): Promise<T> {
  if (!log) return fn();
  return als.run({ log }, fn);
}
