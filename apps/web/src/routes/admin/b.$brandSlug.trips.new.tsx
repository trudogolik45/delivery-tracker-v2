import { lazy, Suspense, useState } from 'react'
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus, X, ChevronRight, ChevronLeft, AlertTriangle, Clock, ArrowLeft } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { apiJson, API_BASE_URL } from '@/lib/api'
import { GeoSearch, type GeoPoint } from '@/components/GeoSearch'
import { TimelineSummary } from '@/components/TimelineSummary'
import { useLivePreview } from '@/hooks/useLivePreview'
import {
  toUnix,
  toLocalDatetime,
  computeTimingError,
  canAdvanceTiming,
  waitLevel,
  canCreate,
} from '@/lib/trip-wizard'
import {
  TripCreateResponseSchema,
  type CargoWithPhotos,
  type GenerateTripInput,
} from '@delivery/schemas'

const RoutePreviewMap = lazy(() => import('@/components/RoutePreviewMap'))

export const Route = createFileRoute('/admin/b/$brandSlug/trips/new')({
  component: TripNew,
})

type Step = 1 | 2 | 3 // Cargo | Timing | Route [R1 AC1]

interface WizardState {
  cargoId: string
  startedAt: string // datetime-local
  desiredArrival: string // datetime-local — «не раньше»
  origin: GeoPoint | null
  destination: GeoPoint | null
  waypoints: (GeoPoint | null)[]
}

const STEPS = ['Cargo', 'Timing', 'Route'] as const
const MAX_WAYPOINTS = 10

const toLatLng = (p: GeoPoint) => ({ lat: p.lat, lng: p.lng, label: p.label })

function TripNew() {
  const { brandSlug } = Route.useParams()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>(1)
  // Всё состояние визарда живёт в одном useState верхнего уровня; шаги — условный
  // рендер, поэтому Back сохраняет ранее введённые значения [R1 AC5, R1 AC8].
  const [state, setState] = useState<WizardState>(() => {
    const now = new Date()
    const arrival = new Date(now.getTime() + 48 * 3600 * 1000) // +48 ч [R2 AC2]
    return {
      cargoId: '',
      startedAt: toLocalDatetime(now),
      desiredArrival: toLocalDatetime(arrival),
      origin: null,
      destination: null,
      waypoints: [],
    }
  })
  const [submitting, setSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const { data: cargoList } = useQuery({
    queryKey: ['admin', brandSlug, 'cargo'],
    queryFn: () => apiJson<CargoWithPhotos[]>(`/admin/b/${brandSlug}/cargo`),
  })

  // Шаг 2 (Timing) — derived-валидация.
  const timingError = computeTimingError(state.startedAt, state.desiredArrival)
  const canNext2 = canAdvanceTiming(state.startedAt, state.desiredArrival)

  // Шаг 3 (Route) — живой пересчёт. Хук вызывается всегда (правило хуков); пока
  // origin/destination не разрешены, он ничего не запрашивает [R3 AC8].
  const preview = useLivePreview(brandSlug, {
    origin: state.origin,
    destination: state.destination,
    waypoints: state.waypoints,
    startedAt: toUnix(state.startedAt),
    desiredArrival: toUnix(state.desiredArrival),
  })
  const trip = preview.data?.trip ?? null
  const lateArrival = preview.data?.lateArrival ?? false
  const lastSeg = trip?.segments.at(-1)
  const trailingWait =
    lastSeg && lastSeg.type === 'rest' && lastSeg.reason === 'wait' ? lastSeg : null
  const idleSeconds = trailingWait ? trailingWait.tEnd - trailingWait.tStart : 0
  const level = waitLevel(idleSeconds)
  const createEnabled = canCreate({
    hasTrip: !!trip,
    loading: preview.loading,
    error: preview.error,
  })

  async function handleSubmit() {
    if (!state.cargoId || !state.origin || !state.destination) return
    setSubmitting(true)
    setCreateError(null)
    try {
      const body: GenerateTripInput = {
        cargoId: state.cargoId,
        origin: toLatLng(state.origin),
        destination: toLatLng(state.destination),
        waypoints: state.waypoints.filter((w): w is GeoPoint => w !== null).map(toLatLng),
        startedAt: toUnix(state.startedAt),
        desiredArrival: toUnix(state.desiredArrival),
      }
      const res = await fetch(`${API_BASE_URL}/admin/b/${brandSlug}/trips`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        setCreateError(typeof json?.error === 'string' ? json.error : 'Failed to create trip')
        return
      }
      const created = TripCreateResponseSchema.parse(json)
      navigate({
        to: '/admin/b/$brandSlug/trips/$tripId',
        params: { brandSlug, tripId: created.tripId },
      })
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create trip')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={`${step === 3 ? 'max-w-5xl' : 'max-w-2xl'} space-y-6`}>
      <Link
        to="/admin/b/$brandSlug/trips"
        params={{ brandSlug }}
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Back
      </Link>
      <h1 className="text-2xl font-bold">New trip</h1>

      {/* Stepper header — ровно три шага [R1 AC1] */}
      <div className="flex items-center gap-1">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-1">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                i + 1 === step
                  ? 'bg-primary text-primary-foreground'
                  : i + 1 < step
                    ? 'bg-muted text-foreground'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {i + 1}
            </div>
            <span className="text-sm hidden sm:block">{label}</span>
            {i < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Step 1: Cargo selection */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Select cargo</h2>
          {!cargoList?.length ? (
            <p className="text-sm text-muted-foreground">
              No cargo yet.{' '}
              <a href={`/admin/b/${brandSlug}/cargo/new`} className="underline">
                Create one first.
              </a>
            </p>
          ) : (
            <div className="grid gap-2">
              {cargoList.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setState((s) => ({ ...s, cargoId: c.id }))}
                  className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted ${
                    state.cargoId === c.id ? 'border-primary bg-primary/5' : ''
                  }`}
                >
                  {c.photoUrls[0] && (
                    <img src={c.photoUrls[0]} alt="" className="h-10 w-10 rounded object-cover" />
                  )}
                  <div>
                    <div className="font-medium">{c.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {Object.keys(c.fields).length} fields · {c.photoUploadIds.length} photos
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={() => setStep(2)} disabled={!state.cargoId}>
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Timing */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Timing</h2>

          <div className="space-y-2">
            <Label htmlFor="startedAt">Departure</Label>
            <Input
              id="startedAt"
              type="datetime-local"
              value={state.startedAt}
              onChange={(e) => setState((s) => ({ ...s, startedAt: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="desiredArrival">
              Earliest arrival — cargo must not arrive before this time
            </Label>
            <Input
              id="desiredArrival"
              type="datetime-local"
              value={state.desiredArrival}
              onChange={(e) => setState((s) => ({ ...s, desiredArrival: e.target.value }))}
            />
            {timingError && <p className="text-sm text-destructive">{timingError}</p>}
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button onClick={() => setStep(3)} disabled={!canNext2}>
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Route + живой preview */}
      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Route</h2>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Левая колонка: форма маршрута */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Origin *</Label>
                <GeoSearch
                  value={state.origin}
                  onChange={(p) => setState((s) => ({ ...s, origin: p }))}
                  placeholder="Search origin address…"
                />
              </div>

              <div className="space-y-2">
                <Label>Destination *</Label>
                <GeoSearch
                  value={state.destination}
                  onChange={(p) => setState((s) => ({ ...s, destination: p }))}
                  placeholder="Search destination address…"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Waypoints (optional, max {MAX_WAYPOINTS})</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={state.waypoints.length >= MAX_WAYPOINTS}
                    onClick={() => setState((s) => ({ ...s, waypoints: [...s.waypoints, null] }))}
                  >
                    <Plus className="mr-1 h-3 w-3" /> Add waypoint
                  </Button>
                </div>
                {state.waypoints.map((w, i) => (
                  <div key={i} className="flex gap-2">
                    <GeoSearch
                      value={w}
                      onChange={(p) =>
                        setState((s) => ({
                          ...s,
                          waypoints: s.waypoints.map((wp, idx) => (idx === i ? p : wp)),
                        }))
                      }
                      placeholder={`Waypoint ${i + 1}…`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setState((s) => ({
                          ...s,
                          waypoints: s.waypoints.filter((_, idx) => idx !== i),
                        }))
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Правая колонка: карта + сводка + предупреждения */}
            <div className="space-y-3">
              <div className="rounded-lg overflow-hidden border" style={{ height: 320 }}>
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Loading map…
                    </div>
                  }
                >
                  <RoutePreviewMap
                    trip={trip}
                    origin={state.origin}
                    destination={state.destination}
                    waypoints={state.waypoints}
                    loading={preview.loading}
                  />
                </Suspense>
              </div>

              {preview.error && (
                <Card className="border-destructive/40 bg-destructive/5 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <p className="text-sm text-destructive">{preview.error}</p>
                  </div>
                </Card>
              )}

              <TimelineSummary trip={trip} loading={preview.loading} />

              {/* Ранний приезд (простой) и поздний приезд взаимоисключающие; оба не блокируют. */}
              {idleSeconds > 0 && (
                <EarlyArrivalWarning idleSeconds={idleSeconds} red={level === 'red'} />
              )}
              {lateArrival && <LateArrivalAdvisory />}
            </div>
          </div>

          <div className="flex items-start justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <div className="flex flex-col items-end gap-1">
              {createError && <p className="text-sm text-destructive">{createError}</p>}
              <Button onClick={handleSubmit} disabled={!createEnabled || submitting}>
                {submitting ? 'Creating trip…' : 'Create trip'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Предупреждение о раннем приезде (простой у точки выгрузки). Не блокирует создание.
function EarlyArrivalWarning({ idleSeconds, red }: { idleSeconds: number; red: boolean }) {
  const hours = (idleSeconds / 3600).toFixed(1)
  if (red) {
    return (
      <Card className="border-destructive/50 bg-destructive/10 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-sm font-medium text-destructive">
            Водитель прибудет за {hours} ч до желаемого окна и будет простаивать у точки выгрузки.
          </p>
        </div>
      </Card>
    )
  }
  return (
    <Card className="p-3">
      <div className="flex items-start gap-2">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Водитель прибудет раньше желаемого окна и будет ожидать у точки выгрузки ({hours} ч).
        </p>
      </div>
    </Card>
  )
}

// Ненавязчивое advisory о позднем приезде. Кнопка Create trip остаётся активной [R3 AC9, OQ-B].
function LateArrivalAdvisory() {
  return (
    <Card className="p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <p className="text-sm text-muted-foreground">
          The truck will arrive after your desired earliest window — you may still create the trip.
        </p>
      </div>
    </Card>
  )
}
