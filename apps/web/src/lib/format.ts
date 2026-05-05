const METERS_PER_MILE = 1609.344

type DateLike = Date | string | number

function toDate(d: DateLike): Date {
  return d instanceof Date ? d : new Date(d)
}

export function formatMiles(meters: number): string {
  const miles = meters / METERS_PER_MILE
  return `${miles.toFixed(0)} mi`
}

export function formatDate(d: DateLike): string {
  return toDate(d).toLocaleDateString('en-US')
}

export function formatDateTime(d: DateLike): string {
  return toDate(d).toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function formatTime(d: DateLike): string {
  return toDate(d).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function formatShortDateTime(d: DateLike): string {
  return toDate(d).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}
