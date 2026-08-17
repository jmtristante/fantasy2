import React from 'react';
import { ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, AlertTriangle, Minus } from 'lucide-react';
import { usePrecioJugador } from '../../contexts/PreciosActualesContext';

function normaliza(str) {
  return (str ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

/**
 * Badge de tendencia con símbolo (flechas + inflexión).
 * Resuelve aceleracion_estado desde v_precio_actual via playerMasterId.
 *
 * Props:
 *   tendencia:      number|null   (positivo=sube, negativo=baja)
 *   playerMasterId: number|string (ID de LaLiga, se mapea a jugador_id de scraping)
 *   className:      string
 */
export default function TrendBadge({ tendencia, playerMasterId, className = '' }) {
  const precio = usePrecioJugador(playerMasterId);
  const aceleracionEstado = precio?.aceleracion_estado ?? null;
  const resolvedTendencia = tendencia ?? precio?.tendencia ?? null;

  const v = resolvedTendencia ?? 0;
  const sube = v > 0;
  const baja = v < 0;
  const verde = v >= 0;
  const norm = normaliza(aceleracionEstado);

  let Icon = Minus;
  let title = 'Sin movimiento';

  if (!norm) {
    if (sube) { Icon = ArrowUp; title = 'Sube'; }
    else if (baja) { Icon = ArrowDown; title = 'Baja'; }
  } else {
    const mucho = norm.includes('mucho');
    if (norm.startsWith('desacelera')) {
      Icon = sube ? (mucho ? ChevronsDown : ArrowDown) : baja ? (mucho ? ChevronsUp : ArrowUp) : Minus;
      title = sube ? 'Sube (desacelera)' : baja ? 'Baja (desacelera)' : 'Sin movimiento';
    } else if (norm.startsWith('acelera')) {
      Icon = sube ? (mucho ? ChevronsUp : ArrowUp) : baja ? (mucho ? ChevronsDown : ArrowDown) : Minus;
      title = sube ? 'Sube (acelera)' : baja ? 'Baja (acelera)' : 'Sin movimiento';
    } else if (norm.startsWith('inflexion')) {
      Icon = AlertTriangle;
      title = 'Inflexión';
    }
  }

  const bg = verde ? 'bg-green-600/90 text-white' : baja ? 'bg-red-600/90 text-white' : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400';

  return (
    <span className={`inline-flex items-center px-1 py-0.5 rounded text-[10px] leading-none shadow ${bg} ${className}`} title={aceleracionEstado || title}>
      <Icon className="w-3 h-3" />
    </span>
  );
}
