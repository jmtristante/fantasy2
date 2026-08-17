// Cliente ligero para leer los datos de scraping de futbolfantasy que ya
// vive en Supabase (precios actuales/diarios, jugadores, equipos).
// Se usa fetch directo a PostgREST (sin SDK extra) con la anon key.
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON = process.env.REACT_APP_SUPABASE_ANON_KEY;

const headers = () => ({
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
  'Content-Type': 'application/json',
});

async function sbGet(table, query, signal) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, { headers: headers(), signal });
  if (!res.ok) throw new Error(`Supabase ${table} ${res.status}`);
  return res.json();
}

// Precios actuales (snapshot). v_precio_actual devuelve una fila por jugador.
export async function getLatestPrices(signal) {
  const rows = await sbGet(
    'v_precio_actual',
    'select=jugador_id,valor,diferencia,diferencia_pct,tendencia,aceleracion_estado&limit=20000',
    signal,
  );
  const map = new Map();
  for (const r of rows || []) {
    map.set(Number(r.jugador_id), {
      valor: r.valor ?? null,
      diferencia: r.diferencia ?? null,
      diferencia_pct: r.diferencia_pct ?? null,
      tendencia: r.tendencia ?? null,
      aceleracion_estado: r.aceleracion_estado ?? null,
    });
  }
  return map;
}

// Jugadores de scraping: id -> { nombre, equipo_id, foto_url }
export async function getScrapingPlayers(signal) {
  const rows = await sbGet(
    'jugadores',
    'select=jugador_id,nombre,equipo_id,foto_url&limit=30000',
    signal,
  );
  const map = new Map();
  for (const r of rows || []) {
    map.set(Number(r.jugador_id), {
      nombre: r.nombre,
      equipo_id: r.equipo_id ?? null,
      foto_url: r.foto_url ?? null,
    });
  }
  return map;
}

// Equipos de scraping: id -> { nombre, escudo_url }
export async function getScrapingEquipos(signal) {
  const rows = await sbGet('equipos', 'select=equipo_id,nombre,escudo_url&limit=200', signal);
  const map = new Map();
  for (const r of rows || []) {
    map.set(Number(r.equipo_id), { nombre: r.nombre, escudo_url: r.escudo_url ?? null });
  }
  return map;
}

// Histórico completo de precios diarios para un conjunto de jugadores.
// Se fragmenta en lotes para no exceder el límite de longitud de URL ni el de
// filas (100k) de PostgREST.
export async function getPreciosDiarios(jugadorIds, signal) {
  if (!jugadorIds.length) return new Map();
  const BATCH = 100;
  const PAGE = 10000;
  const map = new Map();
  for (let i = 0; i < jugadorIds.length; i += BATCH) {
    const lote = jugadorIds.slice(i, i + BATCH);
    let after = '';
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const cursor = after ? `&fecha=gt.${after}` : '';
      const q = `select=jugador_id,fecha,valor&jugador_id=in.(${lote.join(',')})&order=fecha&limit=${PAGE}${cursor}`;
      const rows = await sbGet('precios_diarios', q, signal);
      if (!rows || !rows.length) break;
      for (const r of rows) {
        const id = Number(r.jugador_id);
        if (!map.has(id)) map.set(id, []);
        map.get(id).push({ fecha: r.fecha, valor: Number(r.valor) });
      }
      after = rows[rows.length - 1].fecha;
      if (rows.length < PAGE) break;
    }
  }
  return map;
}

export const isSupabaseConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON);

// Histórico completo de precios para un solo jugador (sin límite de batch).
export async function getPreciosDiariosJugador(jugadorId, signal) {
  if (jugadorId == null) return [];
  const PAGE = 10000;
  const all = [];
  let after = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const cursor = after ? `&fecha=gt.${after}` : '';
    const q = `select=jugador_id,fecha,valor&jugador_id=eq.${jugadorId}&order=fecha&limit=${PAGE}${cursor}`;
    const rows = await sbGet('precios_diarios', q, signal);
    if (!rows || !rows.length) break;
    all.push(...rows);
    after = rows[rows.length - 1].fecha;
    if (rows.length < PAGE) break;
  }
  return all;
}

// Cabeceras para escritura autenticada: la sesion de admin (Bearer access_token)
// hace que PostgREST aplique la RLS como rol authenticated. Sin token, la
// escritura es rechazada por RLS (anon solo tiene SELECT).
function writeHeaders(accessToken) {
  if (!accessToken) throw new Error('Se requiere sesión de Supabase para escribir mapeos');
  return {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

// Tabla de mapeo persistido: player_master_id (LaLiga) -> jugador_id (scraping).
export async function getMapeo(playerMasterIds, signal) {
  if (!playerMasterIds.length) return new Map();
  const ids = playerMasterIds.join(',');
  const rows = await sbGet('mapeo_jugadores', `select=player_master_id,jugador_id&player_master_id=in.(${ids})`, signal);
  const m = new Map();
  for (const r of rows || []) m.set(Number(r.player_master_id), Number(r.jugador_id));
  return m;
}

// Todas las filas de mapeo (vista de admin). Lectura publica (anon SELECT ok).
export async function getAllMapeos(signal) {
  const rows = await sbGet(
    'mapeo_jugadores',
    'select=player_master_id,jugador_id,nombre_laliga,nombre_scraping,equipo,metodo&order=player_master_id&limit=50000',
    signal,
  );
  return rows || [];
}

// Crea/actualiza mapeos. Requiere access_token de sesion admin.
export async function upsertMapeo(rows, accessToken, signal) {
  if (!rows.length) return;
  const url = `${SUPABASE_URL}/rest/v1/mapeo_jugadores?on_conflict=player_master_id`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...writeHeaders(accessToken), Prefer: 'resolution=merge-duplicates, return=minimal' },
    body: JSON.stringify(
      rows.map((r) => ({
        player_master_id: r.player_master_id,
        jugador_id: r.jugador_id,
        nombre_laliga: r.nombre_laliga ?? null,
        nombre_scraping: r.nombre_scraping ?? null,
        equipo: r.equipo ?? null,
        metodo: r.metodo ?? 'auto',
      })),
    ),
    signal,
  });
  if (!res.ok) throw new Error(`Supabase mapeo ${res.status}`);
}

// Elimina un mapeo (desmapear). Requiere sesion admin.
export async function deleteMapeo(playerMasterId, accessToken, signal) {
  const url = `${SUPABASE_URL}/rest/v1/mapeo_jugadores?player_master_id=eq.${playerMasterId}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: writeHeaders(accessToken),
    signal,
  });
  if (!res.ok) throw new Error(`Supabase mapeo delete ${res.status}`);
}

