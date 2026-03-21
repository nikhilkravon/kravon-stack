const API_BASE = 'http://localhost:3002/api';

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`apiGet failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}
