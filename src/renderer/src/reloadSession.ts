export function readReloadSession<T>(key: string, fallback: T): T {
  try { const value = sessionStorage.getItem(key); return value === null ? fallback : JSON.parse(value) as T }
  catch { return fallback }
}
export function saveReloadSession(key: string, value: unknown): void {
  try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* Retain in-memory state. */ }
}
