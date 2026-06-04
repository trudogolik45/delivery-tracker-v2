import { lazy, Suspense, useState } from 'react'
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus, X, ChevronRight, ChevronLeft, AlertTriangle, ArrowLeft } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { apiJson, API_BASE_URL } from '@/lib/api'
import { formatDateTime, formatMiles } from '@/lib/format'
import { GeoSearch, type GeoPoint } from '@/components/GeoSearch'
import type { CargoWithPhotos, Trip, GenerateTripInput } from '@delivery/schemas'

const TripMap = lazy(() => import('@/components/TripMap').then((m) => ({ default: m.TripMap })))

export const Route = createFileRoute('/admin/b/$brandSlug/trips/new')({
  component: TripNew,
})

type Step = 1 | 2 | 3 | 4

interface WizardState {
  cargoId: string
  origin: GeoPoint | null
  destination: GeoPoint | null
  waypoints: (GeoPoint | null)[]
  startedAt: string
  desiredArrival: string
}

function toUnix(localDatetime: string): number {
  return Math.floor(new Date(localDatetime).getTime() / 1000)
}

function toLocalDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function TripNew() {
  const { brandSlug } = Route.useParams()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>(1)
  const [state, setState] = useState<WizardState>(() => {
    const now = new Date()
    const arrival = new Date(now.getTime() + 2 * 24 * 3600 * 1000)
    return {
      cargoId: '',
      origin: null,
      destination: null,
      waypoints: [],
      startedAt: toLocalDatetime(now),
      desiredArrival: toLocalDatetime(arrival),
    }
  })
  const [preview, setPreview] = useState<Trip | null>(null)
  const [previewError, setPreviewError] = useState<{
    message: string
    minimumArrival: number
  } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const { data: cargoList } = useQuery({
    queryKey: ['admin', brandSlug, 'cargo'],
    queryFn: () => apiJson<CargoWithPhotos[]>(`/admin/b/${brandSlug}/cargo`),
  })

  async function fetchPreview(desiredArrivalUnix?: number) {
    if (!state.origin || !state.destination) return
    setPreviewing(true)
    setPreviewError(null)
    try {
      const body = {
        origin: { lat: state.origin.lat, lng: state.origin.lng, label: state.origin.label },
        destination: {
          lat: state.destination.lat,
          lng: state.destination.lng,
          label: state.destination.label,
        },
        waypoints: state.waypoints
          .filter((w): w is GeoPoint => w !== null)
          .map((w) => ({ lat: w.lat, lng: w.lng, label: w.label })),
        startedAt: toUnix(state.startedAt),
        desiredArrival: desiredArrivalUnix ?? toUnix(state.desiredArrival),
      }
      const res = await fetch(`${API_BASE_URL}/admin/b/${brandSlug}/trips/preview`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok) {
        setPreview((data as { trip: Trip }).trip)
      } else if (typeof data.minimumArrival === 'number') {
        const message =
          typeof data.error === 'string' ? data.error : 'Cannot arrive by requested time.'
        setPreviewError({ message, minimumArrival: data.minimumArrival })
      } else {
        const message = typeof data.error === 'string' ? data.error : JSON.stringify(data.error)
        alert(`Preview failed: ${message}`)
      }
    } finally {
      setPreviewing(false)
    }
  }

  async function handleSubmit() {
    if (!state.cargoId || !state.origin || !state.destination) return
    setSubmitting(true)
    try {
      const body: GenerateTripInput = {
        cargoId: state.cargoId,
        origin: { lat: state.origin.lat, lng: state.origin.lng, label: state.origin.label },
        destination: {
          lat: state.destination.lat,
          lng: state.destination.lng,
          label: state.destination.label,
        },
        waypoints: state.waypoints
          .filter((w): w is GeoPoint => w !== null)
          .map((w) => ({ lat: w.lat, lng: w.lng, label: w.label })),
        startedAt: toUnix(state.startedAt),
        desiredArrival: toUnix(state.desiredArrival),
      }
      const res = await fetch(`${API_BASE_URL}/admin/b/${brandSlug}/trips`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok) {
        navigate({
          to: '/admin/b/$brandSlug/trips/$tripId',
          params: { brandSlug, tripId: (data as { tripId: string }).tripId },
        })
      } else {
        alert(`Error: ${data.error}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const steps = ['Cargo', 'Route', 'Time', 'Preview']

  return (
    <div className="max-w-2xl space-y-6">
      <Link
        to="/admin/b/$brandSlug/trips"
        params={{ brandSlug }}
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Back
      </Link>
      <h1 className="text-2xl font-bold">New trip</h1>

      {/* Stepper header */}
      <div className="flex items-center gap-1">
        {steps.map((label, i) => (
          <div key={i} className="flex items-center gap-1">
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
            {i < steps.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
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

      {/* Step 2: Route */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Route</h2>

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
              <Label>Waypoints (optional, max 10)</Label>
              {state.waypoints.length < 10 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setState((s) => ({ ...s, waypoints: [...s.waypoints, null] }))}
                >
                  <Plus className="mr-1 h-3 w-3" /> Add waypoint
                </Button>
              )}
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

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button onClick={() => setStep(3)} disabled={!state.origin || !state.destination}>
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Time */}
      {step === 3 && (
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
            <Label htmlFor="desiredArrival">Desired arrival</Label>
            <Input
              id="desiredArrival"
              type="datetime-local"
              value={state.desiredArrival}
              onChange={(e) => setState((s) => ({ ...s, desiredArrival: e.target.value }))}
            />
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button
              onClick={async () => {
                setStep(4)
                await fetchPreview()
              }}
              disabled={!state.startedAt || !state.desiredArrival}
            >
              Preview <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Preview */}
      {step === 4 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Preview</h2>

          {previewing && <div className="text-sm text-muted-foreground">Generating route…</div>}

          {previewError && (
            <Card className="border-destructive/40 bg-destructive/5 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">{previewError.message}</p>
                  <p className="text-xs text-muted-foreground">
                    Earliest possible arrival: {formatDateTime(previewError.minimumArrival * 1000)}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const min = previewError.minimumArrival
                  setState((s) => ({
                    ...s,
                    desiredArrival: toLocalDatetime(new Date(min * 1000)),
                  }))
                  void fetchPreview(min)
                }}
              >
                Use minimum arrival time
              </Button>
            </Card>
          )}

          {preview && (
            <div className="rounded-lg overflow-hidden border" style={{ height: 360 }}>
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Loading map…
                  </div>
                }
              >
                <TripMap trip={preview} showFooter={false} className="h-full" />
              </Suspense>
            </div>
          )}

          {preview && (
            <div className="text-sm text-muted-foreground">
              <strong>{preview.segments.length}</strong> segments ·{' '}
              <strong>{formatMiles(preview.totalDistance)}</strong>
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(3)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button onClick={handleSubmit} disabled={!preview || submitting || !!previewError}>
              {submitting ? 'Creating trip…' : 'Create trip'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
