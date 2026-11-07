export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export async function apiGetSlackConnectUrl(): Promise<string> {
  const data = await api<{ url: string }>("/api/slack/connect");
  return data.url;
}
