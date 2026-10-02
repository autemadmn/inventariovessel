// Coordenadas del plano. Cada hit mide al menos 80 × 80 unidades y no se solapa.
// Vino y barra VIP: posiciones aproximadas, sin ubicación exacta en el plano.
export const MAPA = {
  viewBox: '40 40 640 1330',
  outline: 'M60 150 H265 V55 H660 V1018 H540 V1355 H55 Z',
  context: [
    { label: 'VIP', poly: '60,150 265,150 265,55 445,55 445,280 480,280 480,495 280,495 280,330 60,330', at: [300, 220] },
    { label: 'Pista', poly: '60,330 280,330 280,495 350,495 350,1300 150,1300 60,1240', at: [200, 860] },
    { label: 'DJ', rect: [60,330,75,82], at: [97,377] },
    { label: 'Descanso', rect: [490,280,100,165], at: [540,368], vertical: true },
    { label: 'Baño', rect: [355,622,63,148], at: [386,700], vertical: true },
    { label: 'Baño', rect: [355,848,63,157], at: [386,930], vertical: true },
    { label: 'Entrada', rect: [55,1185,95,160], at: [102,1270] },
    { label: 'Entrada', rect: [290,1240,115,110], at: [347,1298] },
    { label: 'Personal', rect: [565,550,93,205], at: [612,655], vertical: true },
    { label: 'Pasillo al VIP', rect: [428,1018,112,337], at: [484,1190], vertical: true },
  ],
  points: [
    { key: 'alm-alcohol', poly: '445,60 660,60 660,208 528,208 528,145 445,145', hit: [528,60,132,148], label: 'Alcohol', at: [594,140] },
    { key: 'nevera-vino', rect: [449,64,78,78], hit: [448,62,80,80], label: 'Vino', at: [488,108], approximate: true },
    { key: 'neveras-especial', rects: [[448,245,40,30],[488,245,40,30]], hit: [448,222,80,80], label: 'Especial', at: [488,230] },
    // El hit empieza en 580: no invade el punto de cerveza especial.
    { key: 'chupiteria', rect: [630,228,26,26], hit: [580,210,80,80], label: 'Chupitos', at: [608,278] },
    { key: 'neveras-cerveza', rects: [[628,292,28,30],[628,322,28,30],[628,352,28,30],[628,382,28,30],[628,412,28,30],[628,442,28,30],[628,472,28,30],[628,502,28,30]], hit: [580,290,80,250], label: 'Neveras', at: [604,415], vertical: true },
    { key: 'alm-cerveza', rect: [425,840,235,178], hit: [425,840,235,178], label: ['Cerveza y', 'refrescos'], at: [542,935] },
    { key: 'barra-2', rect: [58,418,57,327], hit: [56,418,84,327], label: 'Barra 2', at: [86,582], vertical: true },
    { key: 'barra-1', rect: [58,860,57,280], hit: [56,860,84,280], label: 'Barra 1', at: [86,1000], vertical: true },
    { key: 'barra-vip', rect: [300,400,140,80], hit: [300,400,140,80], label: 'Barra VIP', at: [370,446], approximate: true },
  ],
};
