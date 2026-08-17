// Operaciones de administracion sobre los mapeos. Todo lo que ESCRIBE exige el
// access_token de la sesion de Supabase (rol authenticated); la app sin sesion
// de admin solo puede leer. La logica de emparejamiento reusa buildPlayerMap.
import { fantasyAPI } from './api';
import {
  getScrapingPlayers,
  getScrapingEquipos,
  getAllMapeos,
  upsertMapeo,
  deleteMapeo,
} from './supabaseScraping';
import { buildPlayerMap } from '../utils/playerMapping';

// fantasyAPI.getAllPlayers() envuelve a veces los jugadores en { data: { elements: [...] } }.
// Extraemos el array sin importar el nivel de anidacion (data / elements).
function toPlayersArray(r) {
  if (Array.isArray(r)) return r;
  if (r && typeof r === 'object') {
    for (const key of ['data', 'elements']) {
      if (Array.isArray(r[key])) return r[key];
    }
    for (const key of ['data', 'elements']) {
      if (r[key] && typeof r[key] === 'object') return toPlayersArray(r[key]);
    }
  }
  return [];
}

// Devuelve TODOS los jugadores de LaLiga de la competición (plantilla completa),
// no solo los de la liga del usuario, para mapear el roster entero de una vez.
async function getAllLaLigaPlayers() {
  const allPlayersRes = await fantasyAPI.getAllPlayers();
  const allPlayers = toPlayersArray(allPlayersRes);
  const allPlayersMap = new Map(allPlayers.map((p) => [String(p.id), p]));
  const teamsMaster = new Map();
  allPlayers.forEach((p) => {
    if (p.team?.id != null) teamsMaster.set(String(p.team.id), { name: p.team.name });
  });
  const laligaPlayers = allPlayers.map((p) => ({ id: p.id, name: p.name, nickname: p.nickname, teamId: p.team?.id }));
  return { laligaPlayers, teamsMaster, allPlayersMap };
}

// Recalcula el mapeo de TODOS los jugadores de LaLiga (sesion admin requerida),
// pero SOLO crea filas para los que aun no estan mapeados: no sobreescribe los
// mapeos existentes (manuales o auto previos).
export async function recomputeMapeos(accessToken, signal) {
  const { laligaPlayers, teamsMaster, allPlayersMap } = await getAllLaLigaPlayers();
  if (!laligaPlayers.length) return { total: 0, mapped: 0, unmapped: 0 };

  // Jugadores ya mapeados: se respetan y no se tocan.
  const existentesRows = await getAllMapeos(signal);
  const mapeados = new Set((existentesRows || []).map((r) => Number(r.player_master_id)));
  const pendientes = laligaPlayers.filter((p) => !mapeados.has(Number(p.id)));
  if (!pendientes.length) return { total: laligaPlayers.length, mapped: 0, unmapped: 0 };

  const [scrapingPlayers, equipos] = await Promise.all([
    getScrapingPlayers(signal),
    getScrapingEquipos(signal),
  ]);

  const map = buildPlayerMap({ laligaPlayers: pendientes, teamsMaster, scrapingPlayers, equipos });
  const rows = [...map.entries()].map(([pmId, jid]) => {
    const p = allPlayersMap.get(String(pmId));
    const teamName = p?.team?.id != null ? teamsMaster.get(String(p.team.id))?.name : null;
    return {
      player_master_id: pmId,
      jugador_id: jid,
      nombre_laliga: p?.nickname || p?.name || null,
      nombre_scraping: scrapingPlayers.get(jid)?.nombre ?? null,
      equipo: teamName ?? null,
      metodo: 'auto',
    };
  });
  if (rows.length) await upsertMapeo(rows, accessToken, signal);
  return { total: laligaPlayers.length, mapped: rows.length, unmapped: laligaPlayers.length - rows.length };
}

export async function saveManualMapeo(
  { player_master_id, jugador_id, nombre_laliga, nombre_scraping, equipo },
  accessToken,
  signal,
) {
  await upsertMapeo(
    [{ player_master_id, jugador_id, nombre_laliga, nombre_scraping, equipo, metodo: 'manual' }],
    accessToken,
    signal,
  );
}

export async function unmapMapeo(playerMasterId, accessToken, signal) {
  await deleteMapeo(playerMasterId, accessToken, signal);
}

export async function fetchAllMapeos(signal) {
  return getAllMapeos(signal);
}
