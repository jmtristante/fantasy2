import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import { fetchRentabilidad } from '../../services/rentabilidad';
import { getPreciosDiariosJugador, isSupabaseConfigured } from '../../services/supabaseScraping';
import { formatCurrency, formatCurrencyCompact } from '../../utils/helpers';
import { Search, X } from 'lucide-react';
import LoadingSpinner from '../Common/LoadingSpinner';
import LineChartSVG from './LineChartSVG';

const COLORES_AMIGOS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2',
  '#db2777', '#65a30d', '#ea580c', '#0d9488', '#4f46e5', '#be123c',
];

const pctTexto = (invertido, rentabilidad) => {
  if (!invertido || invertido <= 0) return null;
  const v = (rentabilidad / invertido) * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;
};

// Positivos arriba, negativos abajo.
const ordenarFilas = (filas) =>
  [...filas].sort((a, b) => {
    const aPos = a.rentabilidad >= 0;
    const bPos = b.rentabilidad >= 0;
    if (aPos !== bPos) return aPos ? -1 : 1;
    return b.rentabilidad - a.rentabilidad;
  });

const Avatar = ({ nombre, foto }) =>
  foto ? (
    <img src={foto} alt="" className="w-9 h-9 rounded-full object-cover" />
  ) : (
    <div className="w-9 h-9 rounded-full bg-primary-400 text-white flex items-center justify-center font-semibold text-sm">
      {(nombre || '?').slice(0, 1).toUpperCase()}
    </div>
  );

const TendenciaBadge = ({ tendencia, aceleracion }) => {
  if (tendencia == null) return null;
  const color = tendencia > 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
    : tendencia < 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  const txt = tendencia > 0 ? '▲' : tendencia < 0 ? '▼' : '±';
  return (
    <span className={`inline-flex items-center text-[10px] px-1 rounded ${color}`}>
      {txt}{aceleracion ? ` ${aceleracion}` : ''}
    </span>
  );
};

function JugadorDetalleModal({ fila, onClose }) {
  const { data: preciosRows } = useQuery({
    queryKey: ['preciosDiarios', fila.jugador_id],
    queryFn: ({ signal }) => getPreciosDiariosJugador(fila.jugador_id, signal),
    enabled: isSupabaseConfigured() && fila.jugador_id != null,
    staleTime: 5 * 60 * 1000,
  });

  const serie = useMemo(() => {
    const rows = preciosRows || [];
    const byDay = new Map();
    for (const r of rows) {
      const d = new Date(r.fecha);
      const lbl = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
      const ts = d.setHours(0, 0, 0, 0);
      const cur = byDay.get(lbl);
      if (!cur || ts >= cur.ts) byDay.set(lbl, { lbl, ts, valor: r.valor });
    }
    const arr = [...byDay.values()].sort((a, b) => a.ts - b.ts);
    return { fechas: arr.map((x) => x.lbl), datos: arr.map((x) => x.valor) };
  }, [preciosRows]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-dark-card rounded-xl border border-gray-200 dark:border-dark-border w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-dark-border">
          {fila.foto ? <img src={fila.foto} alt="" className="w-12 h-12 rounded-md object-cover" /> : <Avatar nombre={fila.nombre} />}
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">{fila.nombre}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{fila.equipo || '—'}{fila.en_plantilla ? ' · En plantilla' : ' · Vendido'}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><div className="text-gray-500">Fichaje</div><div className="font-semibold">{formatCurrency(fila.fichaje)}</div></div>
          <div><div className="text-gray-500">Subidas</div><div className="font-semibold">{formatCurrency(fila.subidas)}</div></div>
          <div><div className="text-gray-500">Ventas</div><div className="font-semibold">{formatCurrency(fila.ventas)}</div></div>
          <div><div className="text-gray-500">Valor actual</div><div className="font-semibold">{formatCurrency(fila.valor_actual)}</div></div>
          <div><div className="text-gray-500">Invertido</div><div className="font-semibold">{formatCurrency(fila.invertido)}</div></div>
          <div><div className="text-gray-500">Devuelto</div><div className="font-semibold">{formatCurrency(fila.devuelto)}</div></div>
          <div><div className="text-gray-500">Rentabilidad</div><div className={`font-semibold ${fila.rentabilidad >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(fila.rentabilidad)}</div></div>
          <div><div className="text-gray-500">Hoy</div><div className="font-semibold">{fila.diferencia_diaria != null ? formatCurrency(fila.diferencia_diaria) : '—'}</div></div>
        </div>
        <div className="p-4">
          <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Histórico de precio (scraping)</h4>
          <LineChartSVG
            fechas={serie.fechas}
            series={[{ nombre: fila.nombre, datos: serie.datos, color: '#2563eb' }]}
            formatY={formatCurrencyCompact}
            height={260}
          />
        </div>
      </div>
    </div>
  );
}

const Rentabilidad = () => {
  const leagueId = useAuthStore((state) => state.leagueId);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['rentabilidad', leagueId],
    queryFn: ({ signal }) => fetchRentabilidad(leagueId, signal),
    enabled: !!leagueId,
    staleTime: 2 * 60 * 1000,
  });

  const [filtro, setFiltro] = useState(null);
  const [soloPlantilla, setSoloPlantilla] = useState(true);
  const [detalle, setDetalle] = useState(null);
  const [busqueda, setBusqueda] = useState('');

  if (isLoading) {
    return <div className="flex justify-center py-16"><LoadingSpinner label="Calculando rentabilidad de la liga..." /></div>;
  }
  if (isError) {
    return (
      <div className="text-center py-16 text-red-500">
        <p>No se pudo calcular la rentabilidad.</p>
        <p className="text-sm text-gray-500 mt-2">{error?.message}</p>
        <button onClick={() => refetch()} className="mt-4 px-4 py-2 rounded-lg bg-primary-400 text-white">Reintentar</button>
      </div>
    );
  }

  const resumen = data?.miembros || [];
  const esGeneral = filtro == null;

  const visibles = (
    esGeneral
      ? [{
          id: -1, nombre: 'General',
          filas: resumen.flatMap((r) => r.filas.map((f) => ({ ...f, miembro_nombre: r.nombre }))),
          invertido: 0, devuelto: 0, rentabilidad: 0, subida_hoy: 0,
        }]
      : resumen.filter((r) => r.id === filtro)
  ).map((r) => {
    const filas = ordenarFilas(soloPlantilla ? r.filas.filter((f) => f.en_plantilla) : r.filas);
    const totales = r.filas.reduce((acc, f) => ({ invertido: acc.invertido + f.invertido, devuelto: acc.devuelto + f.devuelto }), { invertido: 0, devuelto: 0 });
    const subidaHoy = filas.filter((f) => f.en_plantilla).reduce((acc, f) => acc + (f.diferencia_diaria ?? 0), 0);
    return { ...r, filas, invertido: totales.invertido, devuelto: totales.devuelto, rentabilidad: totales.devuelto - totales.invertido, subida_hoy: subidaHoy };
  }).sort((a, b) => {
    const aPos = a.rentabilidad >= 0; const bPos = b.rentabilidad >= 0;
    if (aPos !== bPos) return aPos ? -1 : 1;
    return b.rentabilidad - a.rentabilidad;
  });

  const serieSeries = (data?.serieRentabilidad?.amigos || []).map((a, i) => ({
    nombre: a.nombre, datos: a.datos, color: COLORES_AMIGOS[i % COLORES_AMIGOS.length],
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Rentabilidad</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Lo que cada jugador devuelve (ventas + valor de mercado actual) frente a lo invertido (fichaje + subidas de cláusula).
          Los pagos por puntos aún no están disponibles. El histórico refleja la valoración de la plantilla (sin cash, que la API no expone para otros managers).
        </p>
      </div>

      {data?.supabaseOk === false && (
        <span className="text-xs px-2 py-1 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">
          Supabase no disponible: precios de scraping desactivados
        </span>
      )}

      {resumen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button size="sm" onClick={() => setFiltro(null)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${esGeneral ? 'bg-primary-400 text-white' : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200'}`}>
            General
          </button>
          {resumen.map((r) => (
            <button key={r.id} size="sm" onClick={() => setFiltro(r.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filtro === r.id ? 'bg-primary-400 text-white' : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200'}`}>
              {r.nombre} <span className="ml-1 opacity-70">({r.filas.length})</span>
            </button>
          ))}
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={soloPlantilla} onChange={(e) => setSoloPlantilla(e.target.checked)} className="w-4 h-4" />
            Solo en plantilla
          </label>
        </div>
      )}

      {esGeneral ? (
        resumen.length === 0 ? (
          <div className="text-gray-500 dark:text-gray-400">Sin datos de la liga.</div>
        ) : (
          <div className="flex flex-col gap-4">
            {serieSeries.length > 0 && (
              <div className="rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card p-4">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Evolución diaria del patrimonio (plantilla)</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Valoración de la plantilla de cada amigo día a día (últimas ~8 semanas).</p>
                <LineChartSVG fechas={data.serieRentabilidad.fechas} series={serieSeries} formatY={formatCurrencyCompact} />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {resumen.map((m) => {
                const filasG = soloPlantilla ? m.filas.filter((f) => f.en_plantilla) : m.filas;
                const totalesG = m.filas.reduce((acc, f) => ({ invertido: acc.invertido + f.invertido, devuelto: acc.devuelto + f.devuelto }), { invertido: 0, devuelto: 0 });
                const subidaHoyG = filasG.filter((f) => f.en_plantilla).reduce((acc, f) => acc + (f.diferencia_diaria ?? 0), 0);
                const rentG = totalesG.devuelto - totalesG.invertido;
                const ordenG = ordenarFilas(filasG);
                const topG = ordenG[0] ?? null;
                const peorG = ordenG[ordenG.length - 1] ?? null;
                return (
                  <div key={m.id} className="rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card p-4">
                    <div className="flex items-center gap-3">
                      <Avatar nombre={m.nombre} foto={m.foto} />
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">{m.nombre} <span className="text-xs text-gray-400">({filasG.length})</span></div>
                        <div className="text-xs text-gray-500">Resumen de la liga</div>
                      </div>
                      <div className="ml-auto text-right">
                        <div className={`text-xl font-bold tabular-nums ${rentG > 0 ? 'text-green-600' : rentG < 0 ? 'text-red-600' : ''}`}>{rentG > 0 ? '+' : ''}{formatCurrency(rentG)}</div>
                        <div className="text-xs text-gray-500">{pctTexto(totalesG.invertido, rentG) ?? '—'}</div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div><div className="text-gray-500">Invertido</div><div className="font-medium">{formatCurrency(totalesG.invertido)}</div></div>
                      <div><div className="text-gray-500">Devuelto</div><div className="font-medium">{formatCurrency(totalesG.devuelto)}</div></div>
                      <div><div className="text-gray-500">Beneficio</div><div className={`font-medium ${rentG > 0 ? 'text-green-600' : rentG < 0 ? 'text-red-600' : ''}`}>{rentG > 0 ? '+' : ''}{formatCurrency(rentG)}</div></div>
                      <div><div className="text-gray-500">Subida de hoy</div><div className={`font-medium ${subidaHoyG > 0 ? 'text-green-600' : subidaHoyG < 0 ? 'text-red-600' : ''}`}>{subidaHoyG > 0 ? '+' : ''}{formatCurrency(subidaHoyG)}</div></div>
                    </div>
                    {topG && (
                      <div className="mt-3 flex flex-col gap-1 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-500">Top beneficio</span>
                          <span className="flex min-w-0 items-center gap-1.5">
                            {topG.foto ? <img src={topG.foto} alt="" className="w-5 h-5 rounded object-cover" /> : null}
                            <span className="truncate font-medium">{topG.nombre}</span>
                            <span className="font-semibold text-green-600">+{formatCurrency(topG.rentabilidad)}</span>
                          </span>
                        </div>
                        {peorG && peorG !== topG && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-gray-500">Menos beneficio</span>
                            <span className="flex min-w-0 items-center gap-1.5">
                              {peorG.foto ? <img src={peorG.foto} alt="" className="w-5 h-5 rounded object-cover" /> : null}
                              <span className="truncate font-medium">{peorG.nombre}</span>
                              <span className={`font-semibold ${peorG.rentabilidad < 0 ? 'text-red-600' : 'text-green-600'}`}>{peorG.rentabilidad > 0 ? '+' : ''}{formatCurrency(peorG.rentabilidad)}</span>
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )
      ) : visibles.length === 0 ? (
        <div className="text-gray-500 dark:text-gray-400">Sin datos.</div>
      ) : (
        visibles.map((r) => {
          const termino = busqueda.trim().toLowerCase();
          const filasFiltradas = termino ? r.filas.filter((f) => f.nombre.toLowerCase().includes(termino)) : r.filas;
          return (
            <div key={r.id} className="rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card">
              <div className="flex items-center gap-3 p-4">
                {!esGeneral && <Avatar nombre={r.nombre} foto={r.foto} />}
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">{r.nombre} <span className="text-xs text-gray-400">({r.filas.length})</span></div>
                  <div className="text-xs text-gray-500">{esGeneral ? 'Todos los jugadores de la liga' : 'Rentabilidad de sus jugadores'}</div>
                </div>
                <div className="ml-auto text-right">
                  <div className={`text-xl font-bold tabular-nums ${r.rentabilidad > 0 ? 'text-green-600' : r.rentabilidad < 0 ? 'text-red-600' : ''}`}>{r.rentabilidad > 0 ? '+' : ''}{formatCurrency(r.rentabilidad)}</div>
                  <div className="text-xs text-gray-500">{pctTexto(r.invertido, r.rentabilidad) ?? '—'}</div>
                </div>
              </div>
              <div className="px-4 pb-2 flex flex-wrap gap-4 text-sm">
                <span className="text-gray-500">Invertido: <b className="text-gray-900 dark:text-gray-100">{formatCurrency(r.invertido)}</b></span>
                <span className="text-gray-500">Devuelto: <b className="text-gray-900 dark:text-gray-100">{formatCurrency(r.devuelto)}</b></span>
                <span className="text-gray-500">Subida de hoy: <b className={r.subida_hoy > 0 ? 'text-green-600' : r.subida_hoy < 0 ? 'text-red-600' : 'text-gray-900 dark:text-gray-100'}>{r.subida_hoy > 0 ? '+' : ''}{formatCurrency(r.subida_hoy)}</b></span>
              </div>
              <div className="relative m-4 mt-2">
                <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar jugador…"
                  className="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-dark-bg text-gray-900 dark:text-gray-100 text-sm" />
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              </div>
              <div className="overflow-x-auto px-4 pb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-dark-border">
                      {esGeneral && <th className="p-2">Amigo</th>}
                      <th className="p-2">Jugador</th>
                      <th className="p-2 text-right">Hoy</th>
                      <th className="p-2 text-right">Fichaje</th>
                      <th className="p-2 text-right">Subidas</th>
                      <th className="p-2 text-right">Ventas</th>
                      <th className="p-2 text-right">Valor actual</th>
                      <th className="p-2 text-right">Invertido</th>
                      <th className="p-2 text-right">Devuelto</th>
                      <th className="p-2 text-right">Rentabilidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasFiltradas.map((f) => {
                      const pct = pctTexto(f.invertido, f.rentabilidad);
                      return (
                        <tr key={f.player_master_id ?? f.jugador_id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          {esGeneral && <td className="p-2 text-gray-500">{f.miembro_nombre}</td>}
                          <td className="p-2">
                            <button onClick={() => setDetalle(f)} className="flex items-center gap-2 rounded-md p-1 -m-1 hover:bg-gray-100 dark:hover:bg-gray-700 text-left">
                              {f.foto ? <img src={f.foto} alt="" className="w-9 h-9 rounded-md border object-cover" /> : <Avatar nombre={f.nombre} />}
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{f.nombre}</span>
                                  <TendenciaBadge tendencia={f.tendencia} aceleracion={f.aceleracion_estado} />
                                </div>
                                <div className="text-xs text-gray-500">{f.equipo ?? '—'}{f.en_plantilla ? ' · En plantilla' : ' · Vendido'}</div>
                              </div>
                            </button>
                          </td>
                          <td className="p-2 text-right">
                            {f.diferencia_diaria != null ? (
                              <span className={`font-semibold ${f.diferencia_diaria > 0 ? 'text-green-600' : f.diferencia_diaria < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                                {f.diferencia_diaria > 0 ? '▲' : f.diferencia_diaria < 0 ? '▼' : '±'} {formatCurrency(Math.abs(f.diferencia_diaria))}
                                {f.diferencia_pct_diaria != null && <span className="ml-1 text-xs text-gray-400">{f.diferencia_pct_diaria > 0 ? '+' : ''}{f.diferencia_pct_diaria.toFixed(2)}%</span>}
                              </span>
                            ) : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="p-2 text-right tabular-nums">{formatCurrency(f.fichaje)}</td>
                          <td className="p-2 text-right tabular-nums">{formatCurrency(f.subidas)}</td>
                          <td className="p-2 text-right tabular-nums">{formatCurrency(f.ventas)}</td>
                          <td className="p-2 text-right tabular-nums">{formatCurrency(f.valor_actual)}</td>
                          <td className="p-2 text-right tabular-nums">{formatCurrency(f.invertido)}</td>
                          <td className="p-2 text-right tabular-nums">{formatCurrency(f.devuelto)}</td>
                          <td className="p-2 text-right">
                            <span className={`font-semibold ${f.rentabilidad > 0 ? 'text-green-600' : f.rentabilidad < 0 ? 'text-red-600' : ''}`}>{f.rentabilidad > 0 ? '+' : ''}{formatCurrency(f.rentabilidad)}</span>
                            {pct && <span className="ml-1 text-xs text-gray-400">{pct}</span>}
                          </td>
                        </tr>
                      );
                    })}
                    {filasFiltradas.length === 0 && (
                      <tr><td colSpan={esGeneral ? 10 : 9} className="p-4 text-center text-gray-500">Sin jugadores.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}

      {detalle != null && (
        <JugadorDetalleModal fila={detalle} onClose={() => setDetalle(null)} />
      )}
    </div>
  );
};

export default Rentabilidad;
