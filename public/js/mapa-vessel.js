// Plano de In Vessel calcado al píxel de docs/rediseno/img/plano-vessel.jpg (versión corregida
// del usuario, 1086 × 1448): las coordenadas son las del plano.
// Tres niveles: almacenes (protagonistas), neveras y barras (secundarios) y paredes y zonas de contexto.
// Cada zona táctil mide al menos 72 × 72 unidades (≈ 44 px en un móvil de 390 px).
export const MAPA = {
  viewBox: '36 40 640 1328',
  // Contorno exterior del local (paredes gruesas).
  building: 'M60 152 H264 V56 H660 V1020 H536 V1352 H54 V330 H60 Z',
  // Zona de personal (rojo en el plano): almacenes, pasillos y neveras.
  staff: 'M443 56 H660 V1020 H536 V1352 H426 V495 H590 V280 H443 Z',
  // Tabiques principales (mismo grosor que en el plano).
  walls: [
    'M443 56 V173', 'M443 208 V280 H556', 'M590 280 V491 H506', 'M482 491 H349 V503 H273 V330',
    'M54 330 H181', 'M219 330 H273',
    'M349 503 V777', 'M349 845 V1247',
  ],
  // Tabiques secundarios: cubículos, baños, sala de personal y almacenes.
  partitions: [
    'M528 60 V208', 'M528 208 H557', 'M608 208 H660', 'M446 130 H528',
    'M54 415 H135 V330',
    'M349 623 H421 V1010 H349', 'M349 772 H386', 'M349 847 H421', 'M349 1242 H401 V1352',
    'M561 555 H614 V546 H660', 'M561 555 V646', 'M561 709 V841', 'M556 754 H660',
    'M530 644 H561', 'M530 644 V818 H561', 'M530 710 H561',
    'M561 838 H660', 'M426 1020 H465', 'M492 1020 H660', 'M426 1020 V1352',
  ],
  // Escalera entre la VIP y la pista.
  stairs: { rect: [177, 268, 44, 64], rungs: [279, 290, 301, 312, 323] },
  zones: [
    { label: 'VIP', at: [300, 205], rotate: -40, size: 'big' },
    { label: 'PISTA', at: [210, 900], rotate: -40, size: 'big' },
    { label: 'DJ', at: [95, 373] },
    { label: 'Personal', at: [612, 652], rotate: -90 },
  ],
  points: [
    { key: 'alm-alcohol', kind: 'almacen', rect: [528, 60, 132, 148], hit: [528, 60, 132, 148],
      label: 'Alcohol', at: [600, 94], sub: [600, 120] },
    { key: 'nevera-vino', kind: 'nevera', units: [[538, 152, 30, 46]], hit: [530, 134, 74, 74] },
    { key: 'neveras-especial', kind: 'nevera', units: [[449, 245, 39, 30], [491, 245, 39, 30]], hit: [445, 208, 140, 74],
      label: 'Especial', at: [489, 226], small: true },
    { key: 'chupiteria', kind: 'nevera', units: [[631, 229, 24, 24]], solid: true, hit: [588, 208, 72, 74],
      label: 'Chupitos', at: [622, 241], anchor: 'end', small: true },
    { key: 'neveras-cerveza', kind: 'nevera', hit: [588, 284, 72, 250],
      units: [[630, 264, 25, 30], [630, 296, 25, 30], [630, 328, 25, 30], [630, 360, 25, 30],
        [630, 392, 25, 30], [630, 424, 25, 30], [630, 468, 25, 30], [630, 500, 25, 30]],
      label: 'Neveras', at: [609, 398], vertical: true, small: true },
    { key: 'alm-cerveza', kind: 'almacen', rect: [470, 842, 186, 174], hit: [470, 842, 186, 174],
      label: ['Cerveza y', 'refrescos'], at: [563, 905], sub: [563, 962] },
    { key: 'barra-2', kind: 'barra', rect: [58, 418, 56, 328], hit: [56, 418, 84, 328],
      label: 'Barra 2', at: [86, 582], vertical: true },
    { key: 'barra-1', kind: 'barra', rect: [58, 862, 56, 278], hit: [56, 862, 84, 278],
      label: 'Barra 1', at: [86, 1001], vertical: true },
    // Pegada a las neveras de cerveza especial, en vertical, del lado de la VIP.
    { key: 'barra-vip', kind: 'barra', rect: [462, 288, 50, 150], hit: [437, 284, 100, 158],
      label: 'Barra VIP', at: [487, 363], vertical: true },
  ],
};
