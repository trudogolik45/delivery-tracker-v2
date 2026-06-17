import type { Trip } from '@delivery/schemas'
import { formatMiles } from '@/lib/format'

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

interface TimelineSummaryProps {
  trip: Trip | null
  loading: boolean
}

// Компактная сводка таймлайна рядом с картой: число сегментов, дистанция, маркеры
// пауз и отдельный блок простоя (wait). Расчётное прибытие показывается в блоке
// Timing над картой. Во время пересчёта — skeleton-плейсхолдеры против layout-shift [NFR-3].
export function TimelineSummary({ trip, loading }: TimelineSummaryProps) {
  if (loading) {
    return (
      <div className="space-y-2" aria-hidden>
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-28 animate-pulse rounded bg-muted" />
        <div className="h-4 w-52 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (!trip) {
    return (
      <p className="text-sm text-muted-foreground">
        Enter origin and destination to compute the route timeline.
      </p>
    )
  }

  const segments = trip.segments
  const last = segments.at(-1)
  const trailingWait = last && last.type === 'rest' && last.reason === 'wait' ? last : null
  const idleSeconds = trailingWait ? trailingWait.tEnd - trailingWait.tStart : 0
  const breakCount = segments.filter((s) => s.type === 'rest' && s.reason === 'break').length
  const sleepCount = segments.filter((s) => s.type === 'rest' && s.reason === 'sleep').length

  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <dt className="text-muted-foreground">Segments</dt>
          <dd className="font-medium">{segments.length}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Distance</dt>
          <dd className="font-medium">{formatMiles(trip.totalDistance)}</dd>
        </div>
      </dl>

      {(breakCount > 0 || sleepCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {breakCount > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {breakCount} break{breakCount > 1 ? 's' : ''}
            </span>
          )}
          {sleepCount > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {sleepCount} sleep{sleepCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {trailingWait && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          Ожидание у точки выгрузки: {formatDuration(idleSeconds)}
        </div>
      )}
    </div>
  )
}
