import { MAX_ARRIVAL_WINDOW_SECONDS, WAIT_WARN_THRESHOLD_SECONDS } from '@delivery/schemas'
import type { GeoPoint } from '@/components/GeoSearch'

// Конвертация значения <input type="datetime-local"> (локальное время) в unix-секунды.
export function toUnix(localDatetime: string): number {
  return Math.floor(new Date(localDatetime).getTime() / 1000)
}

// Обратное преобразование Date → строка для <input type="datetime-local">.
export function toLocalDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Шаг 2 (Timing): валидация окна прибытия. desiredArrival — «не раньше».
// Возвращает текст inline-ошибки либо null, если значения ещё не введены или валидны.
export function computeTimingError(startedAt: string, desiredArrival: string): string | null {
  if (!startedAt || !desiredArrival) return null
  const gap = toUnix(desiredArrival) - toUnix(startedAt)
  if (gap <= 0) return 'Earliest arrival must be after departure'
  if (gap > MAX_ARRIVAL_WINDOW_SECONDS) return 'Earliest arrival must be within 14 days of departure'
  return null
}

// Кнопка Next на шаге Timing активна только при двух заполненных и валидных полях.
export function canAdvanceTiming(startedAt: string, desiredArrival: string): boolean {
  return !!startedAt && !!desiredArrival && computeTimingError(startedAt, desiredArrival) === null
}

// Градация предупреждения о простое (хвостовой wait-сегмент): none/notice/red по порогу.
export type WaitLevel = 'none' | 'notice' | 'red'
export function waitLevel(idleSeconds: number): WaitLevel {
  if (idleSeconds <= 0) return 'none'
  if (idleSeconds >= WAIT_WARN_THRESHOLD_SECONDS) return 'red'
  return 'notice'
}

// Кнопка Create trip активна только при готовом маршруте без загрузки и не-late ошибки.
// Поздний приезд и хвостовой wait сюда НЕ передаются, поэтому не блокируют создание.
export function canCreate(opts: { hasTrip: boolean; loading: boolean; error: string | null }): boolean {
  return opts.hasTrip && !opts.loading && opts.error === null
}

// Параметры живого preview и сборка тела запроса (вынесено для юнит-теста).
export interface LivePreviewParams {
  origin: GeoPoint | null
  destination: GeoPoint | null
  waypoints: (GeoPoint | null)[]
  startedAt: number
  desiredArrival: number
}

export interface PreviewRequestBody {
  origin: { lat: number; lng: number; label?: string }
  destination: { lat: number; lng: number; label?: string }
  waypoints: { lat: number; lng: number; label?: string }[]
  startedAt: number
  desiredArrival: number
}

const toLatLng = (p: GeoPoint) => ({ lat: p.lat, lng: p.lng, label: p.label })

// Тело preview-запроса либо null, если origin/destination ещё не разрешены.
// Неразрешённые (null) waypoints исключаются — пересчёт идёт только по разрешённым точкам.
export function buildPreviewBody(params: LivePreviewParams): PreviewRequestBody | null {
  if (!params.origin || !params.destination) return null
  return {
    origin: toLatLng(params.origin),
    destination: toLatLng(params.destination),
    waypoints: params.waypoints.filter((w): w is GeoPoint => w !== null).map(toLatLng),
    startedAt: params.startedAt,
    desiredArrival: params.desiredArrival,
  }
}

// Ключ для useEffect: меняется при правке координат или таймингов. Label не влияет
// на маршрут и в ключ не входит — это исключает лишние пересчёты.
export function serializePreviewKey(params: LivePreviewParams): string | null {
  if (!params.origin || !params.destination) return null
  const coords = (p: GeoPoint) => [p.lat, p.lng]
  return JSON.stringify({
    o: coords(params.origin),
    d: coords(params.destination),
    w: params.waypoints.filter((w): w is GeoPoint => w !== null).map(coords),
    s: params.startedAt,
    a: params.desiredArrival,
  })
}
