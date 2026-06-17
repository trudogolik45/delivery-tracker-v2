import { useEffect, useRef, useState } from 'react'
import { TripPreviewResponseSchema, type TripPreviewResponse } from '@delivery/schemas'
import { API_BASE_URL } from '@/lib/api'
import { buildPreviewBody, serializePreviewKey, type LivePreviewParams } from '@/lib/trip-wizard'

const DEBOUNCE_MS = 600

interface LivePreviewResult {
  data: TripPreviewResponse | null
  loading: boolean
  error: string | null
}

// Живой пересчёт маршрута/timeline на шаге Route: debounce 600 мс + один in-flight
// запрос (AbortController). Запрос уходит только при разрешённых origin+destination;
// неразрешённые waypoints исключаются. lateArrival — НЕ ошибка (приходит в data).
export function useLivePreview(brandSlug: string, params: LivePreviewParams): LivePreviewResult {
  const [data, setData] = useState<TripPreviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const key = serializePreviewKey(params)
  // Свежие параметры читаются в момент отправки запроса, а не на момент планирования.
  // Ref обновляем в эффекте, а не в теле рендера (react-hooks/refs).
  const paramsRef = useRef(params)
  useEffect(() => {
    paramsRef.current = params
  })

  useEffect(() => {
    // Нет origin/destination — ничего не планируем; пустой результат отдаём из рендера [R3 AC8].
    if (key === null) return

    const controller = new AbortController()
    const timer = setTimeout(() => {
      const body = buildPreviewBody(paramsRef.current)
      if (!body) return
      setLoading(true)
      setError(null)
      void (async () => {
        try {
          const res = await fetch(`${API_BASE_URL}/admin/b/${brandSlug}/trips/preview`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          })
          const json = await res.json()
          if (res.ok) {
            setData(TripPreviewResponseSchema.parse(json))
          } else {
            setError(typeof json?.error === 'string' ? json.error : 'Preview failed')
          }
        } catch (e) {
          // Отменённый запрос — ожидаемо, не ошибка [R3 AC3, NFR-2].
          if (e instanceof Error && e.name === 'AbortError') return
          setError('Network error')
        } finally {
          setLoading(false)
        }
      })()
    }, DEBOUNCE_MS)

    // Любая правка ключа: отменяем отложенный таймер и in-flight запрос.
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key, brandSlug])

  // При отсутствии маршрута отдаём пустой результат, не трогая state в эффекте
  // (react-hooks/set-state-in-effect); прошлые data/error не экспонируются [R3 AC8].
  if (key === null) {
    return { data: null, loading: false, error: null }
  }
  return { data, loading, error }
}
