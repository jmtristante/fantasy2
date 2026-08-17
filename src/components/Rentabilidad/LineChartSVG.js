import React, { useRef, useState } from 'react';

// Gráfico de líneas ligero en SVG (sin dependencias). Soporta múltiples series.
// series: [{ nombre, datos: (number|null)[], color }]; fechas: string[].
export default function LineChartSVG({ fechas, series, formatY = (v) => v, height = 320 }) {
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);
  const W = 800;
  const H = height;
  const padL = 64;
  const padR = 16;
  const padT = 10;
  const padB = 24;

  const allVals = series.flatMap((s) => s.datos).filter((v) => v != null && Number.isFinite(v));
  if (fechas.length === 0 || allVals.length === 0) {
    return <div className="h-40 flex items-center justify-center text-gray-400 text-sm">Sin datos históricos.</div>;
  }
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const span = max - min || 1;
  const yMin = min - span * 0.05;
  const yMax = max + span * 0.05;
  const n = fechas.length;
  const x = (i) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / ticks);
  const xTickEvery = Math.ceil(n / 8);

  const onMove = (e) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    let i = Math.round(((rel - padL) / (W - padL - padR)) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    setHover(i);
  };

  return (
    <div>
      <div
        ref={wrapRef}
        className="w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ position: 'relative' }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeDasharray="3 3" className="dark:stroke-gray-700" />
              <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#9ca3af">{formatY(t)}</text>
            </g>
          ))}
          {fechas.map((f, i) =>
            i % xTickEvery === 0 ? (
              <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#9ca3af">{f}</text>
            ) : null
          )}
          {hover != null && (
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="#9ca3af" strokeWidth="1" />
          )}
          {series.map((s, si) => {
            const pts = s.datos
              .map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
              .filter(Boolean)
              .join(' ');
            return <polyline key={si} points={pts} fill="none" stroke={s.color} strokeWidth="2" />;
          })}
        </svg>
        {hover != null && (
          <div
            className="absolute top-2 left-2 bg-white/95 dark:bg-gray-800/95 border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-xs shadow-lg pointer-events-none"
            style={{ left: `${Math.min(80, (hover / Math.max(1, n - 1)) * 100)}%` }}
          >
            <div className="font-semibold text-gray-700 dark:text-gray-200 mb-1">{fechas[hover]}</div>
            {series.map((s, si) => (
              <div key={si} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                <span className="text-gray-500 dark:text-gray-400">{s.nombre}:</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {s.datos[hover] != null ? formatY(s.datos[hover]) : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {series.map((s, si) => (
          <span key={si} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span className="w-3 h-0.5 rounded" style={{ background: s.color }} />
            {s.nombre}
          </span>
        ))}
      </div>
    </div>
  );
}
