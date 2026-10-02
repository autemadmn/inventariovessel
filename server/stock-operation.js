import { HttpError } from './errors.js';

export function quantity(v, what, { allowZero = false } = {}) {
  const valid = typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v));
  const n = valid ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < (allowZero ? 0 : 1) || n > 10000) {
    throw new HttpError(400, `${what}: debe ser un número entero${allowZero ? '' : ' mayor que 0'}.`);
  }
  return n;
}

export function operationKey(value) {
  if (value === undefined) return null; // Clientes anteriores sin clave.
  if (typeof value !== 'string' || !value.trim() || value.length > 100) {
    throw new HttpError(400, 'Identificador de operación no válido.');
  }
  return value;
}

// Dentro de la transacción y después de bloquear los puntos. La respuesta y
// todas las filas del lote se confirman juntas, incluso si se pierde la conexión.
export async function stockOperation(t, key, payload, save) {
  if (!key) return save();
  const content = JSON.stringify(payload);
  const inserted = await t.get(`INSERT INTO stock_operations (key, payload) VALUES (?, ?)
    ON CONFLICT (key) DO NOTHING RETURNING key`, key, content);
  if (!inserted) {
    const prior = await t.get('SELECT payload, response FROM stock_operations WHERE key = ?', key);
    if (prior.payload !== content) throw new HttpError(409, 'El identificador de operación ya se ha usado con otros datos.');
    return JSON.parse(prior.response);
  }
  const result = await save();
  await t.run('UPDATE stock_operations SET response = ? WHERE key = ?', JSON.stringify(result), key);
  return result;
}
