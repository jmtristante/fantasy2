import React, { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getLatestPrices, isSupabaseConfigured } from '../services/supabaseScraping';

// Context: precios actuales + mapeo player_master_id -> jugador_id
const EMPTY = { precios: new Map(), mapeo: new Map() };
const PreciosActualesContext = createContext(EMPTY);

export function PreciosActualesProvider({ children }) {
  const { data } = useQuery({
    queryKey: ['preciosActuales'],
    queryFn: async () => {
      if (!isSupabaseConfigured()) return EMPTY;
      try {
        // Cargar precios actuales (v_precio_actual)
        const precios = await getLatestPrices();
        // Cargar todas las filas de mapeo (player_master_id -> jugador_id)
        const rows = await fetch(
          `${process.env.REACT_APP_SUPABASE_URL}/rest/v1/mapeo_jugadores?select=player_master_id,jugador_id&limit=50000`,
          {
            headers: {
              apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
              Authorization: `Bearer ${process.env.REACT_APP_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
          },
        ).then((r) => (r.ok ? r.json() : []));
        const mapeo = new Map();
        for (const r of rows || []) {
          mapeo.set(Number(r.player_master_id), Number(r.jugador_id));
        }
        return { precios, mapeo };
      } catch {
        return EMPTY;
      }
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  return (
    <PreciosActualesContext.Provider value={data || EMPTY}>
      {children}
    </PreciosActualesContext.Provider>
  );
}

/**
 * Hook para acceder a precios actuales y mapeo.
 * Resuelve player_master_id -> datos de v_precio_actual.
 */
export function usePreciosActuales() {
  return useContext(PreciosActualesContext);
}

/**
 * Hook que dado un player_master_id devuelve { tendencia, aceleracion_estado, valor, ... }.
 */
export function usePrecioJugador(playerMasterId) {
  const { precios, mapeo } = useContext(PreciosActualesContext);
  if (playerMasterId == null) return null;
  const jid = mapeo.get(Number(playerMasterId));
  if (jid == null) return null;
  return precios.get(jid) ?? null;
}
