const TOKEN_KEY = 'cowork_client_token';

export function getStoredClientToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setStoredClientToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getStoredClientToken();
  const headers = new Headers(init.headers || {});
  if (token) {
    headers.set('x-cowork-auth', token);
  }
  return fetch(input, { ...init, headers });
}
