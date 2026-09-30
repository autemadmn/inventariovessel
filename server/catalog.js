// Catálogo inicial (provisional). Solo las botellas de las estanterías de las dos
// barras; la nevera queda fuera. No se inventan capacidades, botellas por caja
// ni fotografías: se dejan vacías hasta que el encargado las confirme.

export const CATEGORIES = [
  { id: 'ginebra', name: 'Ginebras' },
  { id: 'vodka', name: 'Vodkas' },
  { id: 'whisky', name: 'Whiskies' },
  { id: 'ron', name: 'Rones' },
  { id: 'tequila', name: 'Tequila' },
  { id: 'otros', name: 'Otros / sin clasificar' },
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
