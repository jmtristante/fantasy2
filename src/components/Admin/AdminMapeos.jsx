import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Shield, LogIn, LogOut, RefreshCw, Trash2, Link2, Loader2 } from 'lucide-react';
import { useAdminAuthStore } from '../../stores/adminAuthStore';
import { useAuthStore } from '../../stores/authStore';
import { fantasyAPI } from '../../services/api';
import { getScrapingPlayers } from '../../services/supabaseScraping';
import { fetchAllMapeos, recomputeMapeos, saveManualMapeo, unmapMapeo } from '../../services/mapeoAdmin';

const fmtPlayer = (p) => `${p.id} — ${p.nickname || p.name}${p.team?.name ? ` (${p.team.name})` : ''}`;
const fmtScraping = (p) => `${p.jugador_id} — ${p.nombre}${p.equipo_id != null ? ` (#${p.equipo_id})` : ''}`;

export default function AdminMapeos() {
  const { isAdmin, session, login, logout, ensureValidToken, loading, error } = useAdminAuthStore();
  const leagueId = useAuthStore((s) => s.leagueId);
  const leagueName = useAuthStore((s) => s.leagueName);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [savingManual, setSavingManual] = useState(false);

  const { data: laLigaPlayers = [], isLoading: loadingLaLiga, isError: errorLaLiga, error: laLigaError } = useQuery({
    queryKey: ['allPlayers', leagueId],
    queryFn: async () => {
      console.log('[AdminMapeos] allPlayers queryFn EJECUTÁNDOSE');
      try {
        const res = await fantasyAPI.getAllPlayers();
        console.log('[AdminMapeos] allPlayers raw:', JSON.stringify(res)?.slice(0, 500));
        const arr = Array.isArray(res) ? res
          : Array.isArray(res?.data) ? res.data
          : Array.isArray(res?.data?.elements) ? res.data.elements
          : Array.isArray(res?.data?.data) ? res.data.data
          : [];
        console.log('[AdminMapeos] allPlayers extraídos:', arr.length);
        return arr;
      } catch (e) {
        console.error('[AdminMapeos] allPlayers error:', e);
        throw e;
      }
    },
    staleTime: 0,
    cacheTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { data: scrapingPlayers = [] } = useQuery({
    queryKey: ['scrapingPlayers'],
    queryFn: () => {
      const m = new Map();
      return getScrapingPlayers().then((map) => {
        for (const [jid, p] of map.entries()) m.set(Number(jid), { jugador_id: Number(jid), ...p });
        return [...m.values()].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      });
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: mapeos = [], isLoading: loadingMapeos, refetch: refetchMapeos } = useQuery({
    queryKey: ['mapeos'],
    queryFn: () => fetchAllMapeos(),
    staleTime: 30 * 1000,
  });

  const laLigaList = useMemo(() => Array.isArray(laLigaPlayers) ? laLigaPlayers : [], [laLigaPlayers]);
  const scrapingList = useMemo(() => Array.isArray(scrapingPlayers) ? scrapingPlayers : [], [scrapingPlayers]);

  const [filterLaLiga, setFilterLaLiga] = useState('');
  const [filterScraping, setFilterScraping] = useState('');
  const [selLaLiga, setSelLaLiga] = useState(null);
  const [selScraping, setSelScraping] = useState(null);

  const mapByPmId = useMemo(() => new Map(mapeos.map((m) => [String(m.player_master_id), m])), [mapeos]);
  const mapByJId = useMemo(() => new Map(mapeos.map((m) => [String(m.jugador_id), m])), [mapeos]);

  const filteredLaLiga = useMemo(() => {
    const q = filterLaLiga.trim().toLowerCase();
    return q ? laLigaList.filter((p) => fmtPlayer(p).toLowerCase().includes(q)) : laLigaList;
  }, [laLigaList, filterLaLiga]);
  const filteredScraping = useMemo(() => {
    const q = filterScraping.trim().toLowerCase();
    return q ? scrapingList.filter((p) => fmtScraping(p).toLowerCase().includes(q)) : scrapingList;
  }, [scrapingList, filterScraping]);

  const handleLogin = async (e) => {
    e.preventDefault();
    const ok = await login(email, password);
    if (ok) {
      toast.success('Sesión de administrador iniciada');
      setPassword('');
    } else {
      toast.error(error || 'No se pudo iniciar sesión');
    }
  };

  const handleRefresh = async () => {
    if (!leagueId) {
      toast.error('Selecciona una liga primero');
      return;
    }
    const token = await ensureValidToken();
    if (!token) {
      toast.error('Sesión de admin no válida, vuelve a iniciar sesión');
      return;
    }
    setRefreshing(true);
    try {
      const res = await recomputeMapeos(token);
      toast.success(`Mapeo refrescado: ${res.mapped} de ${res.total} jugadores (${res.unmapped} sin mapear)`);
      await refetchMapeos();
    } catch (err) {
      toast.error(`Error al refrescar: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  };

  const handlePair = async () => {
    if (!selLaLiga || !selScraping) return;
    const token = await ensureValidToken();
    if (!token) {
      toast.error('Sesión de admin no válida');
      return;
    }
    setSavingManual(true);
    try {
      await saveManualMapeo(
        {
          player_master_id: Number(selLaLiga.id),
          jugador_id: Number(selScraping.jugador_id),
          nombre_laliga: selLaLiga.nickname || selLaLiga.name || null,
          nombre_scraping: selScraping.nombre ?? null,
          equipo: selLaLiga.team?.name ?? null,
        },
        token,
      );
      toast.success('Mapeo guardado');
      setSelLaLiga(null);
      setSelScraping(null);
      await refetchMapeos();
    } catch (err) {
      toast.error(`Error al guardar: ${err.message}`);
    } finally {
      setSavingManual(false);
    }
  };

  const handleUnmap = async (pmId) => {
    const token = await ensureValidToken();
    if (!token) {
      toast.error('Sesión de admin no válida');
      return;
    }
    try {
      await unmapMapeo(pmId, token);
      toast.success('Mapeo eliminado');
      await refetchMapeos();
    } catch (err) {
      toast.error(`Error al eliminar: ${err.message}`);
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto mt-10">
        <div className="bg-white dark:bg-dark-card rounded-2xl shadow-lg p-6 border border-gray-200 dark:border-dark-border">
          <div className="flex items-center gap-2 mb-4 text-primary-600 dark:text-primary-400">
            <Shield className="w-6 h-6" />
            <h1 className="text-xl font-bold">Admin · Mapeo de jugadores</h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Inicia sesión con Supabase para gestionar los mapeos. Sin sesión nadie puede modificar ni refrescar mapeos.
          </p>
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email de Supabase"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-dark-bg"
              required
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Contraseña"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-dark-bg"
              required
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-white font-semibold hover:bg-primary-600 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              Entrar
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400">
          <Shield className="w-6 h-6" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Admin · Mapeo de jugadores</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Sesión: <span className="font-medium text-gray-700 dark:text-gray-200">{session?.user?.email || 'admin'}</span>
          </span>
          <button onClick={() => logout()} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm">
            <LogOut className="w-4 h-4" /> Cerrar sesión
          </button>
        </div>
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-200">
        Los mapeos solo se crean aquí. La app de rentabilidad (usuarios sin sesión) solo <b>lee</b> lo ya mapeado; no puede escribir ni refrescar.
      </div>

      {/* Refrescar */}
      <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-dark-card rounded-xl border border-gray-200 dark:border-dark-border p-4">
        <button
          onClick={handleRefresh}
          disabled={refreshing || !leagueId}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-white font-semibold hover:bg-primary-600 disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Mapear jugadores sin mapear
        </button>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {leagueName ? `Liga: ${leagueName}` : 'No hay liga seleccionada'}
        </span>
        <span className="text-sm text-gray-400">({mapeos.length} mapeos guardados)</span>
      </div>

      {/* Two interactive tables */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* LaLiga */}
        <div className="bg-white dark:bg-dark-card rounded-xl border border-gray-200 dark:border-dark-border flex flex-col">
          <div className="p-3 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Jugadores LaLiga</h2>
              <span className="text-xs text-gray-400">{laLigaList.length} total</span>
            </div>
            <input
              value={filterLaLiga}
              onChange={(e) => setFilterLaLiga(e.target.value)}
              placeholder="Buscar…"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-dark-bg text-sm"
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {loadingLaLiga ? (
                  <tr><td className="p-4 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline-block" /> Cargando jugadores…</td></tr>
                ) : errorLaLiga ? (
                  <tr><td className="p-4 text-center text-red-400">Error al cargar: {laLigaError?.message || 'desconocido'}</td></tr>
                ) : filteredLaLiga.length === 0 ? (
                  <tr><td className="p-4 text-center text-gray-400">Sin resultados</td></tr>
                ) : filteredLaLiga.map((p) => {
                  const m = mapByPmId.get(String(p.id));
                  const selected = selLaLiga && String(selLaLiga.id) === String(p.id);
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setSelLaLiga(selected ? null : p)}
                      className={`cursor-pointer border-t border-gray-100 dark:border-gray-700 ${selected ? 'bg-primary-50 dark:bg-primary-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                    >
                      <td className="p-3">
                        <div className="font-medium text-gray-800 dark:text-gray-100">{p.nickname || p.name}</div>
                        <div className="text-xs text-gray-400">{p.team?.name || '—'}</div>
                      </td>
                      <td className="p-3 text-right w-32">
                        {m ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 text-xs">
                            ↔ {m.nombre_scraping}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleUnmap(m.player_master_id); }}
                              className="ml-1 text-red-500 hover:text-red-700"
                              title="Desmapear"
                            ><Trash2 className="w-3 h-3" /></button>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">sin mapear</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Scraping */}
        <div className="bg-white dark:bg-dark-card rounded-xl border border-gray-200 dark:border-dark-border flex flex-col">
          <div className="p-3 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Jugadores scraping</h2>
              <span className="text-xs text-gray-400">{scrapingList.length} total</span>
            </div>
            <input
              value={filterScraping}
              onChange={(e) => setFilterScraping(e.target.value)}
              placeholder="Buscar…"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-dark-bg text-sm"
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {filteredScraping.length === 0 ? (
                  <tr><td className="p-4 text-center text-gray-400">Sin resultados</td></tr>
                ) : filteredScraping.map((p) => {
                  const m = mapByJId.get(String(p.jugador_id));
                  const selected = selScraping && String(selScraping.jugador_id) === String(p.jugador_id);
                  return (
                    <tr
                      key={p.jugador_id}
                      onClick={() => setSelScraping(selected ? null : p)}
                      className={`cursor-pointer border-t border-gray-100 dark:border-gray-700 ${selected ? 'bg-primary-50 dark:bg-primary-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                    >
                      <td className="p-3">
                        <div className="font-medium text-gray-800 dark:text-gray-100">{p.nombre}</div>
                        <div className="text-xs text-gray-400">{p.equipo_id != null ? `#${p.equipo_id}` : '—'}</div>
                      </td>
                      <td className="p-3 text-right w-32">
                        {m ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 text-xs">
                            ↔ {m.nombre_laliga}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleUnmap(m.player_master_id); }}
                              className="ml-1 text-red-500 hover:text-red-700"
                              title="Desmapear"
                            ><Trash2 className="w-3 h-3" /></button>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">sin mapear</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Pair bar */}
      {selLaLiga || selScraping ? (
        <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-dark-card rounded-xl border border-primary-200 dark:border-primary-800 p-4">
          <span className="text-sm text-gray-500 dark:text-gray-400">Seleccionados:</span>
          <span className="px-3 py-1.5 rounded-lg bg-primary-100 dark:bg-primary-900/40 text-primary-800 dark:text-primary-200 text-sm font-medium">
            {selLaLiga ? fmtPlayer(selLaLiga) : '— LaLiga —'}
          </span>
          <Link2 className="w-4 h-4 text-gray-400" />
          <span className="px-3 py-1.5 rounded-lg bg-primary-100 dark:bg-primary-900/40 text-primary-800 dark:text-primary-200 text-sm font-medium">
            {selScraping ? fmtScraping(selScraping) : '— scraping —'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => { setSelLaLiga(null); setSelScraping(null); }} className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm">Limpiar</button>
            <button
              onClick={handlePair}
              disabled={!selLaLiga || !selScraping || savingManual}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50 text-sm"
            >
              {savingManual ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              Emparejar
            </button>
          </div>
        </div>
      ) : null}

      {/* Mapeos guardados */}
      <div className="bg-white dark:bg-dark-card rounded-xl border border-gray-200 dark:border-dark-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                <th className="text-left p-3">player_master_id</th>
                <th className="text-left p-3">LaLiga</th>
                <th className="text-left p-3">jugador_id</th>
                <th className="text-left p-3">Scraping</th>
                <th className="text-left p-3">Equipo</th>
                <th className="text-left p-3">Método</th>
                <th className="text-right p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loadingMapeos ? (
                <tr><td colSpan={7} className="p-6 text-center text-gray-400">Cargando mapeos…</td></tr>
              ) : mapeos.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-gray-400">Sin mapeos. Pulsa «Refrescar mapeo».</td></tr>
              ) : (
                mapeos.map((m) => (
                  <tr key={m.player_master_id} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="p-3 font-mono text-gray-500">{m.player_master_id}</td>
                    <td className="p-3">{m.nombre_laliga || '—'}</td>
                    <td className="p-3 font-mono text-gray-500">{m.jugador_id ?? '—'}</td>
                    <td className="p-3">{m.nombre_scraping || '—'}</td>
                    <td className="p-3">{m.equipo || '—'}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${m.metodo === 'manual' ? 'bg-green-100 text-green-700 dark:bg-green-900/30' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30'}`}>
                        {m.metodo}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleUnmap(m.player_master_id)}
                        title="Desmapear"
                        className="inline-flex items-center justify-center p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
