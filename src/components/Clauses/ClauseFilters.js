import React from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';

const SORT_OPTIONS = [
  { value: 'clauseValue', label: 'Cláusula' },
  { value: 'marketValue', label: 'Valor mercado' },
  { value: 'points', label: 'Puntos' },
  { value: 'timeRemaining', label: 'Tiempo' },
];

const POSITIONS = [
  { value: 'all', label: 'Todos' },
  { value: '1', label: 'PO' },
  { value: '2', label: 'DF' },
  { value: '3', label: 'MC' },
  { value: '4', label: 'DL' },
];

const ClauseFilters = ({
  showAll,
  setShowAll,
  ownerFilter,
  setOwnerFilter,
  positionFilter,
  setPositionFilter,
  sortBy,
  setSortBy,
  sortOrder,
  setSortOrder,
  uniqueOwners,
  currentOwnerName,
}) => {
  const pillBase = 'px-3 py-1.5 rounded-full text-xs font-medium border transition-all cursor-pointer select-none';
  const inactive = 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700';
  const activeBlue = 'border-primary-400 bg-primary-50 text-primary-700 dark:border-primary-600 dark:bg-primary-900/30 dark:text-primary-300';
  const activeGreen = 'border-green-400 bg-green-50 text-green-700 dark:border-green-600 dark:bg-green-900/30 dark:text-green-300';

  const ownersWithMe = currentOwnerName && !uniqueOwners.includes(currentOwnerName)
    ? [currentOwnerName, ...uniqueOwners]
    : uniqueOwners;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {/* Disponibilidad */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className={`${pillBase} ${!showAll ? activeGreen : inactive}`}
        >
          Disponibles
        </button>
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className={`${pillBase} ${showAll ? activeBlue : inactive}`}
        >
          Todas
        </button>
      </div>

      <span className="w-px h-5 bg-gray-200 dark:bg-gray-700" />

      {/* Posición */}
      <div className="flex items-center gap-1">
        {POSITIONS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPositionFilter(p.value)}
            className={`${pillBase} ${positionFilter === p.value ? activeBlue : inactive}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <span className="w-px h-5 bg-gray-200 dark:bg-gray-700" />

      {/* Manager */}
      <select
        value={ownerFilter}
        onChange={(e) => setOwnerFilter(e.target.value)}
        className="px-3 py-1.5 rounded-full text-xs font-medium border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 cursor-pointer"
      >
        <option value="all">Todos los managers</option>
        {ownersWithMe.map((owner) => (
          <option key={owner} value={owner}>{owner}</option>
        ))}
      </select>

      <span className="w-px h-5 bg-gray-200 dark:bg-gray-700" />

      {/* Ordenar */}
      <select
        value={sortBy}
        onChange={(e) => setSortBy(e.target.value)}
        className="px-3 py-1.5 rounded-full text-xs font-medium border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 cursor-pointer"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
        className={`${pillBase} ${inactive} flex items-center gap-1`}
        title={sortOrder === 'desc' ? 'Mayor a menor' : 'Menor a mayor'}
      >
        {sortOrder === 'desc' ? (
          <ArrowDownWideNarrow className="w-3 h-3" />
        ) : (
          <ArrowUpNarrowWide className="w-3 h-3" />
        )}
      </button>
    </div>
  );
};

export default ClauseFilters;
