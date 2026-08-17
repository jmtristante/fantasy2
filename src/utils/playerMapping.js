// Mapea playerMasterId de LaLiga Fantasy -> jugador_id de futbolfantasy (scraping).
// Los id NO coinciden, así que emparejamos por nombre. Estrategia por orden de
// confianza:
//   1) nombre completo normalizado (score 3)
//   2) clave corta primer+último token (score 2)
//   3) cualquier palabra del nombre (score 1) -> cubre p.ej. LaLiga "Pedri"
//      contra scraper "Pedri González" porque comparten el token "pedri".
// En empates se desempata por equipo cuando es posible.
const normalize = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// Palabras demasiado cortas o artículos/preposiciones que no identifican a un
// jugador y generarían falsos positivos (p.ej. "de", "san", "fc").
const STOP_TOKENS = new Set([
  'de', 'la', 'el', 'los', 'las', 'y', 'del', 'san', 'santa',
  'mc', 'van', 'der', 'den', 'dos', 'da',
]);
const TOKEN_MIN = 4;

const tokensOf = (s) =>
  normalize(s)
    .split(' ')
    .filter((t) => t.length >= TOKEN_MIN && !STOP_TOKENS.has(t));

// Clave corta: primer + último token (útil cuando un nombre trae apellido
// intercalado que el scraping omite, p.ej. "Sergio Herrera Pirón" -> "sergio piron").
const shortKey = (s) => {
  const t = normalize(s).split(' ').filter(Boolean);
  if (t.length <= 1) return t[0] || '';
  return `${t[0]} ${t[t.length - 1]}`;
};

// Normaliza un nombre de equipo para comparar LaLiga ("Valencia CF") contra
// scraping ("Valencia"): quita palabras de club y normaliza acentos.
function normTeam(t) {
  return normalize(t)
    .replace(/\b(real|cf|fc|ud|cd|ca|sd|club|atletic|atletico|sporting|racing|numancia)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Entre los candidatos (jugador_id -> { equipo_id, score }) elige el mejor.
// score alto = coincidencia más fiable. Si hay varios empatados se prefiere el
// que coincide en equipo (normalizando el nombre de equipo LaLiga vs scraping).
// Si aún quedan varios sin desempatar, no arriesgamos y devolvemos null (mejor
// no mapear a ciegas que mapear mal).
function elegir(cands, teamNorm, equipos) {
  const arr = [...cands.entries()].map(([jid, c]) => ({ jid, equipo_id: c.equipo_id, score: c.score }));
  arr.sort((a, b) => b.score - a.score);
  const top = arr[0].score;
  let mejores = arr.filter((c) => c.score === top);
  if (mejores.length === 1) return mejores[0].jid;
  if (teamNorm) {
    const conEq = mejores.filter((c) => normTeam(equipos.get(c.equipo_id)?.nombre) === teamNorm);
    if (conEq.length >= 1) mejores = conEq;
  }
  // Tras desempatar por equipo: si queda uno, ese; si siguen varios, no mapear.
  if (mejores.length === 1) return mejores[0].jid;
  return null;
}

export function buildPlayerMap({ laligaPlayers, teamsMaster, scrapingPlayers, equipos }) {
  // Índices separados para no confundir nombre completo / clave corta / token.
  // (p.ej. "nico" es una sola palabra: si estuviera mezclado, se trataría como
  // match exacto y empataría con todos los "Nico" del mismo equipo).
  const idxExact = new Map(); // nombre completo normalizado
  const idxShort = new Map(); // primer+último token
  const idxToken = new Map(); // cada palabra
  const put = (map, key, val) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(val);
  };
  // tokens de cada scraper (para la regla de cobertura total S ⊆ L)
  const scraperTokens = new Map();
  for (const [jugadorId, p] of scrapingPlayers.entries()) {
    const val = { jugador_id: jugadorId, equipo_id: p.equipo_id };
    put(idxExact, normalize(p.nombre), val);
    put(idxShort, shortKey(p.nombre), val);
    const toks = tokensOf(p.nombre);
    scraperTokens.set(jugadorId, toks);
    for (const tk of toks) put(idxToken, tk, val);
  }

  const map = new Map();
  for (const lp of laligaPlayers) {
    const cands = new Map(); // jugador_id -> { equipo_id, score }
    const addCand = (jid, score) => {
      if (jid == null) return;
      const eq = scrapingPlayers.get(jid)?.equipo_id;
      const prev = cands.get(jid);
      if (!prev || score > prev.score) cands.set(jid, { equipo_id: eq, score });
    };
    // Probamos nickname y nombre completo (p.ej. "Nico" vs "Nico Williams":
    // el apellido desambigua entre dos "Nico" del mismo equipo).
    const vistos = new Set();
    for (const nombre of [lp.nickname, lp.name].filter(Boolean)) {
      const nk = normalize(nombre);
      if (vistos.has(nk)) continue;
      vistos.add(nk);

      for (const c of idxExact.get(nk) || []) addCand(c.jugador_id, 3);
      for (const c of idxShort.get(shortKey(nombre)) || []) addCand(c.jugador_id, 2);

      // Coincidencia por palabras: exigimos COBERTURA TOTAL para evitar falsos
      // positivos (p.ej. "José Ángel" NO debe mapear a "Miguel Ángel Santaella").
      //   L ⊆ S: LaLiga es subconjunto del scraper (caso "De Haas" ⊆ "Justin De Haas")
      //   S ⊆ L: el scraper es subconjunto de LaLiga (LaLiga trae apellidos extra)
      const L = tokensOf(nombre);
      if (L.length) {
        let inter = null;
        for (const tk of L) {
          const ids = new Set((idxToken.get(tk) || []).map((c) => c.jugador_id));
          inter = inter == null ? ids : new Set([...inter].filter((x) => ids.has(x)));
          if (inter.size === 0) break;
        }
        for (const jid of inter || []) addCand(jid, 2);
        const union = new Set();
        for (const tk of L) for (const c of idxToken.get(tk) || []) union.add(c.jugador_id);
        for (const jid of union) {
          const st = scraperTokens.get(jid);
          if (st && st.length && st.every((t) => L.includes(t))) addCand(jid, 2);
        }
      }
    }

    if (!cands.size) continue;
    const teamName = teamsMaster?.get(String(lp.teamId))?.name;
    const teamNorm = teamName ? normTeam(teamName) : null;
    const chosen = elegir(cands, teamNorm, equipos);
    if (chosen != null) map.set(Number(lp.id), chosen);
  }
  return map;
}
