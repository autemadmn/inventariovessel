// Cliente de la API. Guarda el código de acceso en este dispositivo y el PIN
// de encargado solo durante la sesión del navegador.

const store = {
  get(k, def = null, s = localStorage) {
    try {
      const v = s.getItem(k);
      return v === null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(k, v, s = localStorage) {
    try {
      if (v === null || v === undefined) s.removeItem(k);
      else s.setItem(k, JSON.stringify(v));
    } catch { /* almacenamiento no disponible */ }
  },
};
export { store };

export const auth = {
  get code() { return store.get('accessCode', ''); },
  set code(v) { store.set('accessCode', v || null); },
  get pin() { return store.get('managerPin', '', sessionStorage); },
  set pin(v) { store.set('managerPin', v || null, sessionStorage); },
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let onAuthError = () => {};
export function setAuthErrorHandler(fn) {
  onAuthError = fn;
}

export async function api(path, { method = 'GET', body, manager = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth.code) headers['X-Access-Code'] = auth.code;
  if (manager && auth.pin) headers['X-Manager-Pin'] = auth.pin;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Sin conexión. Revisa la cobertura e inténtalo de nuevo.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, data.error || `Error ${res.status}`);
    if (res.status === 401 || res.status === 403) onAuthError(err, manager);
    throw err;
  }
  return data;
}

export const get = (path, opts) => api(path, opts);
export const post = (path, body, opts = {}) => api(path, { ...opts, method: 'POST', body });
export const put = (path, body, opts = {}) => api(path, { ...opts, method: 'PUT', body });
export const del = (path, opts = {}) => api(path, { ...opts, method: 'DELETE' });

// Conserva la clave si se pierde la respuesta; volver a guardar los mismos
// datos desde este dispositivo reintenta la operación original.
export async function postStock(path, body) {
  const slot = `stockRetry:${path}`;
  const payload = JSON.stringify(body);
  let pending = store.get(slot);
  if (!pending || pending.payload !== payload) {
    pending = { payload, key: crypto.randomUUID() };
    store.set(slot, pending);
  }
  const result = await post(path, { ...body, key: pending.key });
  store.set(slot, null);
  return result;
}

// Atajos para la zona de gestión (envían el PIN).
export const mget = (path) => api(path, { manager: true });
export const mpost = (path, body) => api(path, { manager: true, method: 'POST', body });
export const mput = (path, body) => api(path, { manager: true, method: 'PUT', body });
export const mdel = (path) => api(path, { manager: true, method: 'DELETE' });
