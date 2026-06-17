import type { Segment } from '@delivery/schemas'

// Поздний приезд выводится из сохранённого таймлайна без расширения TripAdmin:
// последний сегмент кончается после desiredArrival И это не хвостовой wait
// (наличие wait означает ранний приезд, погашенный ожиданием → не поздно).
export function deriveLateArrival(desiredArrivalIso: string, segments: Segment[]): boolean {
  const desiredUnix = Math.floor(new Date(desiredArrivalIso).getTime() / 1000)
  const last = segments.at(-1)
  if (!last) return false
  const hasTrailingWait = last.type === 'rest' && last.reason === 'wait'
  return !hasTrailingWait && last.tEnd > desiredUnix + 1
}
