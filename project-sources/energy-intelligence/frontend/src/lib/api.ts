let sessionToken: string | null = null;
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { ...options, cache: 'no-store' });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const error = await response.json();
      if (typeof error.detail === 'string') message = error.detail;
    } catch {
      /* Proxy may return HTML when the API is unavailable. */
    }
    throw new Error(message);
  }
  return response.json();
}
export async function write<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  if (!sessionToken) sessionToken = (await api<{ token: string }>('/session')).token;
  try {
    return await api<T>(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-ETIP-Token': sessionToken },
      body: JSON.stringify(body),
    });
  } catch (error) {
    sessionToken = null;
    throw error;
  }
}
export const number = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : value.toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const dateTime = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString('en-GB', {
        timeZone: 'UTC',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }) + ' UTC'
    : 'Not available';
export const timeLabel = (value: string) =>
  new Date(value).toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
