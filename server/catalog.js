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
