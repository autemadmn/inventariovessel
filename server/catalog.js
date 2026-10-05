// Catálogo inicial (provisional). Solo las botellas de las estanterías de las dos
// barras; la nevera queda fuera. No se inventan capacidades, botellas por caja
// ni fotografías: se dejan vacías hasta que el encargado las confirme.

export const CATEGORIES = [
  { id: 'ginebra', name: 'Ginebras' },
  { id: 'vodka', name: 'Vodkas' },
  { id: 'whisky', name: 'Whiskies' },
  { id: 'ron', name: 'Rones' },
  { id: 'tequila', name: 'Tequila' },
  { id: 'licor', name: 'Licores' },
  { id: 'cerveza', name: 'Cervezas' },
  { id: 'refresco', name: 'Refrescos' },
  { id: 'vino', name: 'Vinos' },
  { id: 'otros', name: 'Otros / sin clasificar' },
];

export const SECTIONS = [
  { id: 'alcohol', name: 'Alcohol' }, { id: 'nevera', name: 'Nevera' },
  { id: 'chupiteria', name: 'Chupitería' }, { id: 'refrescos', name: 'Refrescos' },
  { id: 'otros', name: 'Otros' },
];
export const ORDER_UNITS = [
  { id: 'botella', one: 'botella', many: 'botellas' },
  { id: 'caja', one: 'caja', many: 'cajas' },
  { id: 'bolsa', one: 'bolsa', many: 'bolsas' },
];

// status: confirmado | pendiente (dato por confirmar) | sin_identificar | descartado
const ok = (name) => ({ name, status: 'confirmado' });
const check = (name, note) => ({ name, status: 'pendiente', note });

export const INITIAL_CATALOG = {
  ginebra: [
    ok('Bulldog London Dry'),
    ok('Brockmans'),
    ok('Hendrick’s'),
    ok('Roku'),
    ok('G’Vine Floraison'),
    ok('Macaronesian White Gin'),
    ok('Nordés'),
    ok('Martin Miller’s'),
    ok('Tanqueray London Dry'),
    ok('Larios Rosé'),
    ok('Larios Pomelo'),
    ok('Larios 12'),
    ok('Master’s London Dry'),
    ok('Master’s Pink'),
    check('Puerto de Indias', 'Aparentemente Strawberry; confirmar la variedad.'),
    ok('Zeeland Nº8'),
    ok('Zeeland Pink Nº12'),
  ],
  vodka: [
    ok('Belvedere Organic'),
    ok('Beluga Noble'),
    ok('Tito’s Handmade Vodka'),
    ok('Cîroc Original'),
    ok('Cîroc Apple'),
    ok('Cîroc Red Berry'),
    ok('Cîroc French Vanilla'),
    ok('Cîroc Pineapple'),
    ok('SKYY'),
    ok('Moskovskaya'),
  ],
  whisky: [
    ok('Jack Daniel’s Old No. 7'),
    ok('Dewar’s White Label'),
    ok('Johnnie Walker Red Label'),
    ok('J&B Rare'),
    ok('DYC 8'),
    check('Glenmorangie The Original', 'Confirmar la edad.'),
    ok('Monkey Shoulder'),
    ok('Chivas Regal 12'),
    check('The Macallan 12', 'Confirmar la expresión concreta.'),
  ],
  ron: [
    ok('Cacique Añejo'),
    ok('Barceló Añejo'),
    ok('Barceló Imperial'),
    check('Flor de Caña Añejo Reserva', 'Confirmar la edad.'),
    ok('Flor de Caña 12'),
    ok('Abuelo Añejo'),
    ok('Abuelo 12'),
    ok('Brugal Doble Reserva'),
    ok('Brugal 1888'),
    ok('Brugal Añejo'),
    check('Zacapa', 'Aparentemente Solera 23; confirmar la variedad.'),
    check('Old / Old Sport', 'Etiqueta «OLD» con letras manuscritas naranjas. Identificación provisional: confirmar marca y categoría.'),
  ],
  tequila: [
    ok('Don Julio Reposado'),
  ],
};

// Botellas vistas en las fotos que aún no se sabe qué son. No aparecen como
// botones para pedir: el encargado debe identificarlas (producto nuevo) o
// marcarlas como un producto que ya existe, para no crear duplicados.
export const UNIDENTIFIED = [
  {
    name: 'Botella pequeña y oscura',
    category: 'otros',
    note: 'Situada entre The Macallan y Zacapa. Pendiente de identificar.',
  },
  {
    name: 'Botella de ron con malla',
    category: 'ron',
    note: 'Situada entre Barceló y Flor de Caña. Podría ser otra variedad de Brugal o un producto ya incluido. No crear duplicado hasta confirmarlo.',
  },
];

// Fotos de referencia incluidas con la app (fuentes y licencias en
// public/img/botellas/CREDITOS.md). Solo para productos confirmados: los que
// están por confirmar o sin identificar no llevan foto hasta saber cuál es la
// botella exacta. El encargado puede sustituirlas por fotos propias.
export const PHOTOS = {
  'Brockmans': '/img/botellas/brockmans.jpg',
  'Hendrick’s': '/img/botellas/hendricks.jpg',
  'Roku': '/img/botellas/roku.jpg',
  'Nordés': '/img/botellas/nordes.jpg',
  'Tanqueray London Dry': '/img/botellas/tanqueray-london-dry.jpg',
  'Larios Rosé': '/img/botellas/larios-rose.jpg',
  'Larios 12': '/img/botellas/larios-12.jpg',
  'Beluga Noble': '/img/botellas/beluga-noble.jpg',
  'Tito’s Handmade Vodka': '/img/botellas/titos-handmade-vodka.jpg',
  'Cîroc Red Berry': '/img/botellas/ciroc-red-berry.jpg',
  'Cîroc Pineapple': '/img/botellas/ciroc-pineapple.jpg',
  'SKYY': '/img/botellas/skyy.jpg',
  'Moskovskaya': '/img/botellas/moskovskaya.jpg',
  'Jack Daniel’s Old No. 7': '/img/botellas/jack-daniels-old-no-7.jpg',
  'Johnnie Walker Red Label': '/img/botellas/johnnie-walker-red-label.jpg',
  'J&B Rare': '/img/botellas/j-b-rare.jpg',
  'Monkey Shoulder': '/img/botellas/monkey-shoulder.jpg',
  'Chivas Regal 12': '/img/botellas/chivas-regal-12.jpg',
  'Cacique Añejo': '/img/botellas/cacique-anejo.jpg',
  'Barceló Imperial': '/img/botellas/barcelo-imperial.jpg',
  'Brugal Doble Reserva': '/img/botellas/brugal-doble-reserva.jpg',
  'Brugal Añejo': '/img/botellas/brugal-anejo.jpg',
  'Don Julio Reposado': '/img/botellas/don-julio-reposado.jpg',
  'G’Vine Floraison': '/img/botellas/gvine-floraison.jpg',
  'Martin Miller’s': '/img/botellas/martin-millers.jpg',
  'Dewar’s White Label': '/img/botellas/dewars-white-label.jpg',
  'DYC 8': '/img/botellas/dyc-8.jpg',
  'Barceló Añejo': '/img/botellas/barcelo-anejo.jpg',
  'Brugal 1888': '/img/botellas/brugal-1888.jpg',
};

// Botellas habituales de la estantería (foto del 28 sep 2026), en el orden en
// que están colocadas. Forman el grupo inicial «Habituales»; el resto de
// productos activos va a «Resto». Después lo gestiona el encargado desde
// Gestión → Selección.
export const HABITUAL_SLUGS = [
  'moskovskaya',
  'skyy',
  'zeeland-n8',
  'puerto-de-indias',
  'masters-pink',
  'larios-rose',
  'larios-pomelo',
  'larios-12',
  'tanqueray-london-dry',
  'masters-london-dry',
  'jack-daniels-old-no-7',
  'dewars-white-label',
  'johnnie-walker-red-label',
  'j-b-rare',
  'old-old-sport',
  'dyc-8',
  'cacique-anejo',
  'barcelo-anejo',
  'brugal-anejo',
];

export const INITIAL_GROUPS = ['Habituales', 'Resto'];

export const INITIAL_STAFF = ['Carlos', 'Sergio', 'Alejandro'];
export const INITIAL_STORES = [
  { id: 1, name: 'Almacén alcohol', kind: 'local', sort: 10, point_type: 'almacen', map_key: 'alm-alcohol', bar_id: null, in_vessel: 1 },
  { id: 3, name: 'Nevera de vino', kind: 'local', sort: 11, point_type: 'nevera', map_key: 'nevera-vino', bar_id: null, in_vessel: 1 },
  { id: 4, name: 'Almacén cerveza y refrescos', kind: 'local', sort: 12, point_type: 'almacen', map_key: 'alm-cerveza', bar_id: null, in_vessel: 1 },
  { id: 5, name: 'Neveras de cerveza', kind: 'local', sort: 13, point_type: 'nevera', map_key: 'neveras-cerveza', bar_id: null, in_vessel: 1 },
  { id: 6, name: 'Neveras cerveza especial', kind: 'local', sort: 14, point_type: 'nevera', map_key: 'neveras-especial', bar_id: null, in_vessel: 1 },
  { id: 7, name: 'Nevera chupitería', kind: 'local', sort: 15, point_type: 'nevera', map_key: 'chupiteria', bar_id: null, in_vessel: 1 },
  { id: 8, name: 'Barra 1', kind: 'local', sort: 16, point_type: 'barra', map_key: 'barra-1', bar_id: 1, in_vessel: 1 },
  { id: 9, name: 'Barra 2', kind: 'local', sort: 17, point_type: 'barra', map_key: 'barra-2', bar_id: 2, in_vessel: 1 },
  { id: 10, name: 'Barra VIP', kind: 'local', sort: 18, point_type: 'barra', map_key: 'barra-vip', bar_id: null, in_vessel: 1 },
  { id: 2, name: 'Out Vessel', kind: 'central', sort: 20, point_type: null, map_key: null, bar_id: null, in_vessel: 0 },
];
export const POINT_KEYS = INITIAL_STORES.filter((s) => s.in_vessel).map((s) => s.map_key);
export const SHELF_ORDER = ['ginebra', 'ron', 'vodka', 'whisky', 'tequila', 'licor', 'cerveza', 'refresco', 'vino', 'otros'];
export function defaultMainKey(category) {
  return ['cerveza', 'refresco'].includes(category) ? 'alm-cerveza' : category === 'vino' ? 'nevera-vino' : 'alm-alcohol';
}

/**
 * Identificador estable de un producto (nombre del archivo de su imagen).
 * Se fija al crear el producto y no cambia al renombrarlo.
 */
export function slugify(name) {
  return String(name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[º°ª’'`´]/g, '')
    .replace(/&/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'producto';
}
