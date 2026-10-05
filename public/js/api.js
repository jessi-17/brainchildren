// Every call carries the token the server put in the page, so other
// websites open in your browser can't talk to brainchildren.
const token = document.querySelector('meta[name="bc-token"]')?.content || '';

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'x-bc-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (res.status === 401 && data?.error === 'stale-token') {
    // the server restarted, so the page needs the new token
    location.reload();
    throw new Error('reloading');
  }
  if (!res.ok) {
    const err = new Error(data?.error || `request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => call('GET', url),
  post: (url, body) => call('POST', url, body || {}),
  patch: (url, body) => call('PATCH', url, body),
  del: (url) => call('DELETE', url),
};
