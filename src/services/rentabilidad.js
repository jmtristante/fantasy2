import { fantasyAPI } from './api';
import { extractTeamPlayers } from '../utils/fetchAllTeamsData';
import { useAuthStore } from '../stores/authStore';
import {
  getLatestPrices,
  getScrapingPlayers,
  getScrapingEquipos,
  getPreciosDiarios,
  getMapeo,
  isSupabaseConfigured,
} from './supabaseScraping';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CMP = `/v1/competition/${process.env.REACT_APP_COMPETITION_ID || '1'}`;

// Todo el mundo arranca la liga con equipo aleatorio y 100M en mano.
const PRESUPUESTO_INICIAL = 100_000_000;

// activityTypeId del API (ver activityUtils.js):
// 1 compró (a otro manager o mercado) · 6 premio jornada · 9 nuevo miembro ·
// 31 fichó (mercado) · 32 clausuló · 33 vendió.
// 32 es compra por cláusula (fichaje), NO subida de cláusula propia.
const TIPO_COMPRA_MANAGER = 1;
const TIPO_PREMIO = 6;
const TIPO_UNION = 9;
const TIPO_FICHAJE_MERCADO = 31;
const TIPO_CLAUSULA = 32;
const TIPO_VENTA = 33;

// Fallback si no hay actividad de unión ni fecha en teamData (arranque 26/27).
const FECHA_INICIO_TEMPORADA = '2026-08-15T00:00:00.000Z';

// Petición que NO pasa por el interceptor de api.js (evita toasts de
// "Acceso denegado" cuando la API rechaza ver datos de otros managers).
// Usa la misma URL base que el cliente api.js (respeta REACT_APP_API_BASE_URL).
async function silentGet(path) {
  const token = useAuthStore.getState().getBearerToken();
  const isDev = process.env.NODE_ENV === 'development';
  let base;
  if (isDev) {
    const port = process.env.REACT_APP_PROXY_PORT || '3005';
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const host = window.location.hostname || 'localhost';
    base = `${protocol}//${host}:${port}/api`;
  } else {
    base = (process.env.REACT_APP_API_BASE_URL || `${window.location.origin}/api`).replace(/\/$/, '');
  }
  const url = `${base}${path}`;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'x-lang': 'es',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    if (!r.ok) return null;
    const text = await r.text();
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const dayStart = (f) => {
  const d = new Date(f);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

const toIso = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && !Number.isFinite(Number(v))) {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  const n = Number(v);
  if (Number.isFinite(n)) {
    // segundos vs ms
    const ms = n < 1e12 ? n * 1000 : n;
    const t = new Date(ms).getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  return null;
};

// Fecha en la que el manager entró en la liga (teamData). Sondea campos habituales.
const extractTeamJoinDate = (teamData) => {
  const cand = [teamData?.data, teamData, teamData?.team, teamData?.data?.team];
  const fields = ['joinTime', 'startTime', 'joinedAt', 'createdAt', 'created', 'creationDate'];
  for (const o of cand) {
    if (!o || typeof o !== 'object') continue;
    for (const t of fields) {
      const val = o[t] ?? o.manager?.[t] ?? o.team?.[t];
      const iso = toIso(val);
      if (iso) return iso;
    }
  }
  return null;
};

// Carga el mapeo persistido (player_master_id -> jugador_id). SOLO LECTURA.
async function resolverMapeo({ laligaPlayers, signal }) {
  const map = new Map();
  if (!isSupabaseConfigured()) return map;
  try {
    const m = await getMapeo(
      laligaPlayers.map((p) => p.id),
      signal,
    );
    for (const [k, v] of m) map.set(k, v);
  } catch {
    /* mapa vacío: jugadores sin mapear */
  }
  return map;
}

async function getAllActivity(leagueId, maxPages = 25) {
  const items = [];
  for (let page = 0; page < maxPages; page++) {
    const res = await fantasyAPI.getLeagueActivity(leagueId, page);
    const arr = Array.isArray(res) ? res : res?.data || [];
    if (!arr.length) break;
    items.push(...arr);
    await sleep(200);
  }
  return items;
}

// Reduce precios_diarios a un valor por día (el último del día).
// Map jugador_id -> [{ ts, label, valor }] ordenado por día.
function reducirPreciosDiarios(porJugador) {
  const out = new Map();
  const dayLabel = (f) => {
    const d = new Date(f);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
  };
  for (const [jid, rows] of porJugador.entries()) {
    const byDay = new Map();
    for (const r of rows) {
      const lbl = dayLabel(r.fecha);
      const ts = dayStart(r.fecha);
      if (ts == null) continue;
      const cur = byDay.get(lbl);
      if (!cur || ts >= cur.ts) byDay.set(lbl, { ts, label: lbl, valor: r.valor });
    }
    out.set(jid, [...byDay.values()].sort((a, b) => a.ts - b.ts));
  }
  return out;
}

// userId del item de unión (activityTypeId 9).
function unionUserId(a) {
  return a.user1Id ?? a.user2Id ?? a.manager?.id ?? a.manager?.userId ?? null;
}

/**
 * Calcula la rentabilidad:
 *  - Por cada (amigo, jugador): fichaje / subidas / ventas / valor actual /
 *    diferencia diaria / tendencia; rentabilidad = devuelto - invertido.
 *  - Drafts = valor de mercado el día que el manager entró en la liga.
 *  - Serie histórica = cash (100M + movimientos + premios) + plantilla día a día.
 */
export async function fetchRentabilidad(leagueId, signal) {
  const standingRes = await fantasyAPI.getLeagueRanking(leagueId);
  const miembros = Array.isArray(standingRes) ? standingRes : standingRes?.data || [];
  if (!miembros.length) {
    return {
      miembros: [],
      serieRentabilidad: { fechas: [], amigos: [] },
      supabaseOk: isSupabaseConfigured(),
    };
  }

  const allPlayersRes = await fantasyAPI.getAllPlayers();
  const allPlayers = Array.isArray(allPlayersRes) ? allPlayersRes : allPlayersRes?.data || [];
  const allPlayersMap = new Map(allPlayers.map((p) => [String(p.id), p]));

  const activity = await getAllActivity(leagueId);

  let latestPrices = new Map();
  let scrapingPlayers = new Map();
  let equipos = new Map();
  let supabaseOk = false;
  if (isSupabaseConfigured()) {
    try {
      [latestPrices, scrapingPlayers, equipos] = await Promise.all([
        getLatestPrices(signal),
        getScrapingPlayers(signal),
        getScrapingEquipos(signal),
      ]);
      supabaseOk = true;
    } catch {
      supabaseOk = false;
    }
  }

  // Fechas de unión por manager (activityTypeId 9).
  const joinByMid = new Map();
  for (const a of activity) {
    if (a.activityTypeId !== TIPO_UNION) continue;
    const mid = unionUserId(a);
    if (mid == null || !a.createdAt) continue;
    const ts = new Date(a.createdAt).getTime();
    if (!Number.isFinite(ts)) continue;
    const prev = joinByMid.get(Number(mid));
    if (prev == null || ts < prev) joinByMid.set(Number(mid), ts);
  }

  const fechaInicioFallback = new Date(FECHA_INICIO_TEMPORADA).getTime();
  let fechaActividadMasTemprana = fechaInicioFallback;
  for (const ts of joinByMid.values()) {
    if (ts < fechaActividadMasTemprana) fechaActividadMasTemprana = ts;
  }
  // Si no hay uniones, usa la actividad más antigua con fecha.
  if (joinByMid.size === 0 && activity.length) {
    let minTs = Infinity;
    for (const a of activity) {
      if (!a.createdAt) continue;
      const ts = new Date(a.createdAt).getTime();
      if (Number.isFinite(ts) && ts < minTs) minTs = ts;
    }
    if (Number.isFinite(minTs)) fechaActividadMasTemprana = minTs;
  }
  const fechaInicio = fechaActividadMasTemprana;
  const inicioIso = new Date(fechaInicio).toISOString();

  // Plantillas actuales + fecha de entrada por manager.
  const detalle = await mapLimit(miembros, 4, async (m) => {
    const teamId = m.id || m.team?.id;
    const mid = Number(m.userId ?? teamId);
    let players = [];
    let joinTs = joinByMid.has(mid)
      ? new Date(joinByMid.get(mid)).toISOString()
      : null;
    try {
      const raw = await silentGet(`${CMP}/leagues/${leagueId}/teams/${teamId}?x-lang=es`);
      if (!joinTs) {
        joinTs = extractTeamJoinDate(raw) || inicioIso;
      }
      players = extractTeamPlayers(raw)
        .map((pt) => {
          const pm = pt?.playerMaster || pt?.player || {};
          const id = pm.id ?? pt?.id;
          return id != null
            ? {
                playerMasterId: Number(id),
                nickname: pm.nickname || pm.name,
                marketValue: num(pm.marketValue ?? pt?.marketValue),
              }
            : null;
        })
        .filter(Boolean);
    } catch {
      if (!joinTs) joinTs = inicioIso;
    }
    await sleep(100);
    return { teamId: Number(teamId), mid, players, joinTs };
  });

  const mvMap = new Map();
  for (const d of detalle) {
    for (const p of d.players) {
      mvMap.set(`${d.mid}:${p.playerMasterId}`, p.marketValue);
    }
  }

  const scopeIds = new Set();
  activity.forEach((a) => a.playerMasterId != null && scopeIds.add(Number(a.playerMasterId)));
  detalle.forEach((d) => d.players.forEach((p) => scopeIds.add(Number(p.playerMasterId))));
  const laligaPlayers = [...scopeIds]
    .map((id) => {
      const p = allPlayersMap.get(String(id));
      return p ? { id: p.id, name: p.name, nickname: p.nickname, teamId: p.team?.id } : null;
    })
    .filter(Boolean);

  const map = await resolverMapeo({ laligaPlayers, signal });
  const scopeJugadores = [...new Set([...map.values()])];

  let preciosDiarios = new Map();
  if (supabaseOk && scopeJugadores.length) {
    try {
      preciosDiarios = await getPreciosDiarios(scopeJugadores, signal);
    } catch {
      preciosDiarios = new Map();
    }
  }
  const preciosPorDia = reducirPreciosDiarios(preciosDiarios);

  // Valor de entrada (draft) = último precio en/antes del día de entrada del manager.
  const valorEntrada = (jid, fecha) => {
    const arr = preciosPorDia.get(jid);
    if (!arr || !arr.length) return null;
    if (fecha == null) return arr[0].valor;
    const target = dayStart(fecha);
    if (target == null) return arr[0].valor;
    let cand = null;
    for (const x of arr) {
      if (x.ts <= target) cand = x.valor;
      else break;
    }
    return cand ?? arr[0].valor;
  };

  const jugadorInfo = new Map();
  for (const [jid, p] of scrapingPlayers.entries()) {
    const eq = equipos.get(p.equipo_id);
    jugadorInfo.set(jid, {
      nombre: p.nombre,
      equipo: eq?.nombre ?? null,
      foto: p.foto_url ?? null,
      escudo: eq?.escudo_url ?? null,
    });
  }

  // Movimientos de actividad -> stubs por (miembro, jugador LaLiga).
  const porKey = new Map();
  const keyDe = (m, pmId) => `${m}:${pmId}`;
  const stub = (m, pmId) => {
    const k = keyDe(m, pmId);
    let s = porKey.get(k);
    if (!s) {
      s = {
        invertido: 0,
        devuelto: 0,
        fichaje: 0,
        subidas: 0,
        ventas: 0,
        jugador_id: map.get(Number(pmId)) ?? null,
        tuvoCompra: false,
      };
      porKey.set(k, s);
    }
    return s;
  };

  for (const a of activity) {
    const pmId = a.playerMasterId != null ? Number(a.playerMasterId) : null;
    if (pmId == null) continue;
    const t = a.activityTypeId;
    const amount = num(a.amount);

    if (t === TIPO_VENTA) {
      if (a.user1Id != null) {
        const s = stub(a.user1Id, pmId);
        s.devuelto += amount;
        s.ventas += amount;
      }
    } else if (t === TIPO_COMPRA_MANAGER) {
      // Traspaso / compra: user1 paga, user2 (si hay) cobra.
      if (a.user1Id != null) {
        const s = stub(a.user1Id, pmId);
        s.invertido += amount;
        s.fichaje += amount;
        s.tuvoCompra = true;
      }
      if (a.user2Id != null) {
        const s = stub(a.user2Id, pmId);
        s.devuelto += amount;
        s.ventas += amount;
      }
    } else if (t === TIPO_FICHAJE_MERCADO || t === TIPO_CLAUSULA) {
      // 31 fichaje mercado · 32 compra por cláusula → coste de adquisición (fichaje).
      if (a.user1Id != null) {
        const s = stub(a.user1Id, pmId);
        s.invertido += amount;
        s.fichaje += amount;
        s.tuvoCompra = true;
      }
    }
    // Resto de tipos (4 blindaje, 6 premio, 7 alineación, 9 unión…): no afectan a fichaje.
  }

  // Drafts: jugadores de plantilla inicial sin compra conocida.
  // 1) Los que siguen en plantilla (están en detalle).
  for (const d of detalle) {
    for (const p of d.players) {
      const k = keyDe(d.mid, p.playerMasterId);
      const existing = porKey.get(k);
      if (existing?.tuvoCompra) continue;
      const s = stub(d.mid, p.playerMasterId);
      if (s.fichaje > 0 || s.tuvoCompra) continue;
      const j = s.jugador_id;
      const mv = mvMap.get(k) ?? 0;
      const fechaDraft = d.joinTs || inicioIso;
      const entrada =
        (j != null ? valorEntrada(j, fechaDraft) : null) ??
        latestPrices.get(j)?.valor ??
        mv;
      s.invertido += entrada;
      s.fichaje += entrada;
    }
  }
  // 2) Los que ya fueron vendidos (aparecen en actividad pero no en plantilla
  //    actual): necesitan su fichaje al precio del día de entrada del manager.
  const joinTsByMid = new Map();
  for (const d of detalle) joinTsByMid.set(d.mid, d.joinTs || inicioIso);
  for (const [k, s] of porKey.entries()) {
    if (s.tuvoCompra || s.fichaje > 0) continue;
    const [mRaw] = k.split(':');
    const mid = Number(mRaw);
    const j = s.jugador_id;
    const mv = mvMap.get(k) ?? 0;
    const fechaDraft = joinTsByMid.get(mid) || inicioIso;
    const entrada =
      (j != null ? valorEntrada(j, fechaDraft) : null) ??
      latestPrices.get(j)?.valor ??
      mv;
    s.invertido += entrada;
    s.fichaje += entrada;
  }

  // Valor actual de los que siguen en plantilla (devuelto).
  const owners = new Set();
  for (const d of detalle) {
    for (const p of d.players) {
      const k = keyDe(d.mid, p.playerMasterId);
      owners.add(k);
      const s = stub(d.mid, p.playerMasterId);
      const j = s.jugador_id;
      const mv = mvMap.get(k) ?? null;
      const valor = (j != null ? latestPrices.get(j)?.valor : null) ?? mv;
      if (valor != null) s.devuelto += valor;
    }
  }

  const filasPorMiembro = new Map();
  for (const [k, s] of porKey.entries()) {
    const [mRaw, pmRaw] = k.split(':');
    const mid = Number(mRaw);
    const pmId = Number(pmRaw);
    const j = s.jugador_id;
    const info = j != null ? jugadorInfo.get(j) : null;
    const enPlantilla = owners.has(k);
    const lp = j != null ? latestPrices.get(j) : null;
    const mv = mvMap.get(k) ?? null;
    const laLiga = allPlayersMap.get(String(pmId));
    const fila = {
      jugador_id: j,
      player_master_id: pmId,
      nombre: info?.nombre ?? laLiga?.nickname ?? laLiga?.name ?? 'Jugador',
      equipo: info?.equipo ?? laLiga?.team?.name ?? null,
      foto: info?.foto ?? null,
      escudo: info?.escudo ?? null,
      fichaje: s.fichaje,
      subidas: s.subidas,
      ventas: s.ventas,
      valor_actual: enPlantilla ? (lp?.valor ?? mv) : null,
      diferencia_diaria: lp?.diferencia ?? null,
      diferencia_pct_diaria: lp?.diferencia_pct ?? null,
      tendencia: lp?.tendencia ?? null,
      aceleracion_estado: lp?.aceleracion_estado ?? null,
      en_plantilla: enPlantilla,
      invertido: s.invertido,
      devuelto: s.devuelto,
      rentabilidad: s.devuelto - s.invertido,
    };
    const lista = filasPorMiembro.get(mid) ?? [];
    lista.push(fila);
    filasPorMiembro.set(mid, lista);
  }

  const resumen = miembros
    .map((m) => {
      const mid = Number(m.userId ?? m.id);
      const filas = filasPorMiembro.get(mid) ?? [];
      const totales = filas.reduce(
        (acc, f) => ({
          invertido: acc.invertido + f.invertido,
          devuelto: acc.devuelto + f.devuelto,
        }),
        { invertido: 0, devuelto: 0 },
      );
      const subidaHoy = filas
        .filter((f) => f.en_plantilla)
        .reduce((acc, f) => acc + (f.diferencia_diaria ?? 0), 0);
      return {
        id: mid,
        teamId: Number(m.id ?? m.team?.id),
        nombre: m.manager || m.name || 'Amigo',
        foto: null,
        filas,
        invertido: totales.invertido,
        devuelto: totales.devuelto,
        rentabilidad: totales.devuelto - totales.invertido,
        subida_hoy: subidaHoy,
      };
    })
    .sort((a, b) => b.rentabilidad - a.rentabilidad);

  const serieRentabilidad = buildSerieHistorica({
    miembros,
    detalle,
    map,
    activity,
    preciosPorDia,
    latestPrices,
    inicioIso,
  });

  return {
    miembros: resumen,
    serieRentabilidad,
    supabaseOk,
    preciosDiarios,
    ligaInicio: inicioIso,
  };
}

function buildSerieHistorica({
  miembros,
  detalle,
  map,
  activity,
  preciosPorDia,
  latestPrices,
  inicioIso,
}) {
  const toDayStart = (f) => dayStart(f) ?? 0;

  const holds = new Map();
  const setHold = (m, j, kind, ts) => {
    if (m == null || j == null) return;
    const k = `${Number(m)}:${j}`;
    let h = holds.get(k);
    if (!h) {
      h = { j, acq: Infinity, sale: null };
      holds.set(k, h);
    }
    if (kind === 'acq') {
      if (ts < h.acq) h.acq = ts;
    } else if (h.sale == null || ts > h.sale) {
      h.sale = ts;
    }
  };

  // Drafts / plantilla actual sin movimiento: alta = fecha de entrada del manager.
  for (const d of detalle) {
    for (const p of d.players) {
      const j = map.get(Number(p.playerMasterId));
      if (j == null) continue;
      const k = `${d.mid}:${j}`;
      if (!holds.has(k)) {
        setHold(d.mid, j, 'acq', toDayStart(d.joinTs ?? inicioIso));
      }
    }
  }

  for (const a of activity) {
    const j = a.playerMasterId != null ? map.get(Number(a.playerMasterId)) : null;
    if (j == null) continue;
    const ts = toDayStart(a.createdAt);
    const t = a.activityTypeId;
    if (t === TIPO_VENTA) {
      if (a.user1Id != null) setHold(a.user1Id, j, 'sale', ts);
    } else if (t === TIPO_COMPRA_MANAGER) {
      if (a.user1Id != null) setHold(a.user1Id, j, 'acq', ts);
      if (a.user2Id != null) setHold(a.user2Id, j, 'sale', ts);
    } else if (t === TIPO_FICHAJE_MERCADO || t === TIPO_CLAUSULA) {
      if (a.user1Id != null) setHold(a.user1Id, j, 'acq', ts);
    }
  }

  // Cash: 100M + compras/ventas + premios de jornada.
  const presu = new Map();
  for (const m of miembros) presu.set(Number(m.userId ?? m.id), PRESUPUESTO_INICIAL);
  const importesPorMiembro = new Map();
  for (const a of activity) {
    const t = a.activityTypeId;
    const amount = num(a.amount);
    const agregar = (midRaw, delta) => {
      if (midRaw == null) return;
      const mid = Number(midRaw);
      const arr = importesPorMiembro.get(mid) ?? [];
      arr.push({ ts: toDayStart(a.createdAt), imp: delta });
      importesPorMiembro.set(mid, arr);
    };
    if (t === TIPO_VENTA) agregar(a.user1Id, amount);
    else if (t === TIPO_COMPRA_MANAGER) {
      agregar(a.user1Id, -amount);
      agregar(a.user2Id, amount);
    } else if (t === TIPO_FICHAJE_MERCADO || t === TIPO_CLAUSULA) {
      agregar(a.user1Id, -amount);
    } else if (t === TIPO_PREMIO) {
      agregar(a.user1Id, amount);
    }
  }
  for (const arr of importesPorMiembro.values()) arr.sort((a, b) => a.ts - b.ts);

  const inicioDia = toDayStart(inicioIso);
  const finDia = toDayStart(new Date());
  const diasArr = [];
  for (let t = inicioDia; t <= finDia; t += 864e5) {
    const d = new Date(t);
    diasArr.push({
      ts: t,
      label: `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`,
    });
  }
  if (diasArr.length === 0) {
    const d = new Date();
    diasArr.push({
      ts: finDia,
      label: `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`,
    });
  }

  const hoyLabel = diasArr[diasArr.length - 1].label;

  const amigos = miembros.map((m) => {
    const mid = Number(m.userId ?? m.id);
    const ultimo = new Map();
    const importes = importesPorMiembro.get(mid) ?? [];
    const holdsM = [...holds.entries()]
      .filter(([k]) => k.startsWith(`${mid}:`))
      .map(([, h]) => h);
    const datos = diasArr.map((dia) => {
      let cash = presu.get(mid) ?? PRESUPUESTO_INICIAL;
      for (const it of importes) {
        if (it.ts <= dia.ts) cash += it.imp;
        else break;
      }
      let equipo = 0;
      for (const h of holdsM) {
        if (dia.ts < h.acq) continue;
        if (h.sale != null && dia.ts >= h.sale) continue;
        const pm = preciosPorDia.get(h.j);
        let p = null;
        if (dia.label === hoyLabel) {
          p = latestPrices.get(h.j)?.valor ?? (pm && pm.length ? pm[pm.length - 1].valor : 0);
        } else if (pm) {
          let cand = null;
          for (const x of pm) {
            if (x.ts <= dia.ts) cand = x.valor;
            else break;
          }
          p = cand ?? ultimo.get(h.j) ?? 0;
        } else {
          p = ultimo.get(h.j) ?? 0;
        }
        ultimo.set(h.j, p);
        equipo += p;
      }
      return cash + equipo;
    });
    return { id: mid, nombre: m.manager || m.name || 'Amigo', datos };
  });

  return { fechas: diasArr.map((d) => d.label), amigos };
}
