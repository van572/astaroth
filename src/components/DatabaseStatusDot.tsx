import { useDatabaseStatus } from '../hooks/useDatabaseStatus';

interface DatabaseStatusDotProps {
  compact?: boolean;
  showFullLabel?: boolean;
}

export function DatabaseStatusDot({
  compact = false,
  showFullLabel = false,
}: DatabaseStatusDotProps) {
  const { status, label, refresh } = useDatabaseStatus();

  const dotColorClass =
    status === 'active'
      ? 'bg-emerald-500'
      : status === 'inactive'
      ? 'bg-red-500'
      : 'bg-slate-400';

  const textColorClass =
    status === 'active'
      ? 'text-emerald-700'
      : status === 'inactive'
      ? 'text-red-700'
      : 'text-slate-500';

  const displayLabel = showFullLabel
    ? label
    : status === 'active'
    ? 'BD activa'
    : status === 'inactive'
    ? 'BD inactiva'
    : 'Verificando BD...';

  return (
    <button
      type="button"
      onClick={() => void refresh()}
      title={`${label} (clic para comprobar)`}
      className={`inline-flex items-center gap-1.5 text-left transition-opacity hover:opacity-80 whitespace-nowrap shrink-0 ${
        compact ? 'text-xs' : 'text-xs font-medium'
      } ${textColorClass}`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotColorClass}`}
      />
      <span>{displayLabel}</span>
    </button>
  );
}
