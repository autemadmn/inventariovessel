// Ritmo de consulta de /api/live. Cada consulta es una petición que Cloudflare
// cuenta, así que solo se consulta deprisa donde hace falta.

/** Milisegundos hasta la próxima consulta, según la pantalla y el tiempo sin tocarla. */
export function pollDelay(view, idleMs) {
  if (view === 'reponer') return 6000; // quien repone espera avisos aunque no toque la pantalla
  if (idleMs < 2 * 60000) return view === 'pedir' ? 5000 : 15000;
  if (idleMs < 15 * 60000) return 30000;
  return 120000;
}
