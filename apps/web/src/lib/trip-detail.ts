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

// Фактическое время прибытия водителя к клиенту = конец последнего сегмента вождения.
// Для раннего приезда это момент ДО ожидания у точки выгрузки (хвостовой wait), а не
// конец таймлайна; для позднего — совпадает с концом таймлайна. null, если ехать некуда.
export function arrivalAtDestination(segments: Segment[]): number | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!
    if (seg.type === 'driving') return seg.tEnd
  }
  return null
}
