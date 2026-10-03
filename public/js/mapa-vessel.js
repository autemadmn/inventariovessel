// Plano de In Vessel calcado de docs/rediseno/img/plano-vessel.jpg (mismas coordenadas).
// Tres niveles: almacenes (protagonistas), neveras y barras (secundarios) y contexto tenue.
// Cada zona táctil mide al menos 75 × 75 unidades (≈ 44 px en un móvil de 390 px).
// Barra VIP: no sale en el plano; su posición es aproximada.
export const MAPA = {
  viewBox: '48 48 620 1316',
  // Contorno exterior del local.
  building: 'M60 150 H265 V55 H660 V1020 H540 V1355 H55 V325 H60 Z',
  // Zona de personal (rojo en el plano): almacenes, pasillos y neveras.
  staff: 'M445 55 H660 V1020 H540 V1355 H425 V495 H590 V280 H445 Z',
  // Separación entre la VIP y la pista.
  walls: 'M60 325 H275 V495 H425',
  zones: [
    { label: 'VIP', at: [205, 240] },
    { label: 'PISTA', at: [240, 900] },
  ],
  points: [
    { key: 'alm-alcohol', kind: 'almacen', rect: [528, 60, 132, 148], hit: [528, 60, 132, 148],
      label: 'Alcohol', at: [594, 96], sub: [594, 122] },
    { key: 'nevera-vino', kind: 'nevera', units: [[540, 152, 34, 46]], hit: [530, 132, 76, 76],
      label: 'Vino', at: [584, 176], anchor: 'start', small: true },
    { key: 'neveras-especial', kind: 'nevera', units: [[450, 246, 37, 30], [490, 246, 37, 30]], hit: [445, 208, 140, 76],
      label: 'Especial', at: [488, 226], small: true },
    { key: 'chupiteria', kind: 'nevera', units: [[631, 229, 24, 24]], solid: true, hit: [585, 208, 75, 76],
      label: 'Chupitos', at: [622, 241], anchor: 'end', small: true },
    { key: 'neveras-cerveza', kind: 'nevera', hit: [585, 284, 75, 252],
      units: [[630, 262, 25, 30], [630, 294, 25, 30], [630, 330, 25, 30], [630, 362, 25, 30],
        [630, 398, 25, 30], [630, 430, 25, 30], [630, 466, 25, 30], [630, 498, 25, 30]],
      label: 'Neveras', at: [610, 395], vertical: true, small: true },
    { key: 'alm-cerveza', kind: 'almacen', rect: [520, 838, 140, 182], hit: [520, 838, 140, 182],
      label: ['Cerveza y', 'refrescos'], at: [590, 905], sub: [590, 962] },
    { key: 'barra-2', kind: 'barra', rect: [62, 418, 50, 328], hit: [56, 418, 84, 328],
      label: 'Barra 2', at: [87, 582], vertical: true },
    { key: 'barra-1', kind: 'barra', rect: [62, 862, 50, 278], hit: [56, 862, 84, 278],
      label: 'Barra 1', at: [87, 1001], vertical: true },
    { key: 'barra-vip', kind: 'barra', rect: [290, 70, 140, 40], hit: [285, 60, 150, 80],
      label: 'Barra VIP', at: [360, 91], approximate: true },
  ],
};
