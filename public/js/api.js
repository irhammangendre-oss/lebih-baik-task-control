// Pembungkus fetch: header CSRF, JSON, dan pesan error berbahasa Indonesia.
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = { 'X-Requested-With': 'lb-app' };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Tidak ada koneksi. Periksa internet Anda lalu coba lagi.');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') window.dispatchEvent(new CustomEvent('lb:unauthorized'));
    throw new ApiError(res.status, data?.error || `Gagal (${res.status})`);
  }
  return data;
}
