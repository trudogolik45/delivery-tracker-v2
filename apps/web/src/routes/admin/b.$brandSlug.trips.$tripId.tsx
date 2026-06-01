import { useState } from 'react'
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Check, Trash2, ArrowLeft, PauseCircle, PlayCircle } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { apiJson, apiRequest } from '@/lib/api'
import { formatDateTime, formatMiles, formatShortDateTime } from '@/lib/format'
import { TripMap } from '@/components/TripMap'
import type { TripAdmin, Segment } from '@delivery/schemas'

export const Route = createFileRoute('/admin/b/$brandSlug/trips/$tripId')({
  component: TripDetail,
})

const PAUSE_PRESETS = [
  { label: '1 h', seconds: 3600 },
  { label: '2 h', seconds: 7200 },
  { label: '4 h', seconds: 14400 },
  { label: '6 h', seconds: 21600 },
  { label: '8 h', seconds: 28800 },
]

function TripDetail() {
  const { brandSlug, tripId } = Route.useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [pauseOpen, setPauseOpen] = useState(false)
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', brandSlug, 'trips', tripId],
    queryFn: () => apiJson<TripAdmin>(`/admin/b/${brandSlug}/trips/${tripId}`),
  })

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest(`/admin/b/${brandSlug}/trips/${tripId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', brandSlug, 'trips'] })
      navigate({ to: '/admin/b/$brandSlug/trips', params: { brandSlug } })
    },
  })

  const pauseMutation = useMutation({
    mutationFn: (durationSeconds: number | null) =>
      apiRequest(`/admin/b/${brandSlug}/trips/${tripId}/pause`, {
        method: 'POST',
        body: durationSeconds !== null ? { durationSeconds } : undefined,
      }),
    onSuccess: () => {
      setPauseOpen(false)
      setSelectedDuration(null)
      qc.invalidateQueries({ queryKey: ['admin', brandSlug, 'trips', tripId] })
    },
  })

  const resumeMutation = useMutation({
    mutationFn: () => apiRequest(`/admin/b/${brandSlug}/trips/${tripId}/resume`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', brandSlug, 'trips', tripId] }),
  })

  async function copyShareUrl(url: string) {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>
  if (error || !data) return <div className="text-sm text-destructive">Trip not found.</div>

  const shareUrl = `https://${data.shareDomain}/s/${data.shareHash}`
  const lastPause = data.trip?.pauses.at(-1)
  const nowSec = Date.now() / 1000
  const isPaused = lastPause !== undefined && (lastPause.resumedAt === undefined || lastPause.resumedAt > nowSec)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/admin/b/$brandSlug/trips"
          params={{ brandSlug }}
          className={buttonVariants({ variant: 'ghost', size: 'icon' })}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-bold">{data.cargoTitle}</h1>
      </div>

      {/* Map */}
      {data.trip && (
        <div className="rounded-lg overflow-hidden border" style={{ height: 400 }}>
          <TripMap trip={data.trip} showFooter className="h-full" />
        </div>
      )}

      {/* Info + Share URL */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground truncate">
            Share:{' '}
            <a
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              {shareUrl}
            </a>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => copyShareUrl(shareUrl)}>
          {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
          {copied ? 'Copied!' : 'Copy link'}
        </Button>
      </div>

      {/* Pause / Resume */}
      {data.trip && (
        <div className="flex gap-2 items-center">
          {isPaused ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending}
            >
              <PlayCircle className="mr-1 h-4 w-4" /> Resume trip
            </Button>
          ) : (
            <Dialog open={pauseOpen} onOpenChange={setPauseOpen}>
              <DialogTrigger render={<Button variant="outline" size="sm" />}>
                <PauseCircle className="mr-1 h-4 w-4" /> Pause trip
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Pause trip</DialogTitle>
                  <DialogDescription>
                    Choose how long the stop will take, or leave unset for manual resume.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap gap-2 py-2">
                  {PAUSE_PRESETS.map((p) => (
                    <Button
                      key={p.seconds}
                      variant={selectedDuration === p.seconds ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedDuration(selectedDuration === p.seconds ? null : p.seconds)}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
                {selectedDuration === null && (
                  <p className="text-xs text-muted-foreground">Manual resume — no auto-resume scheduled.</p>
                )}
                <DialogFooter>
                  <Button variant="ghost" onClick={() => { setPauseOpen(false); setSelectedDuration(null) }}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => pauseMutation.mutate(selectedDuration)}
                    disabled={pauseMutation.isPending}
                  >
                    Confirm pause
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {isPaused && <Badge variant="secondary">Paused</Badge>}
        </div>
      )}

      {/* Trip meta */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Departure</p>
          <p className="font-medium">{formatDateTime(data.startsAt)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Desired arrival</p>
          <p className="font-medium">{formatDateTime(data.desiredArrival)}</p>
        </div>
        {data.trip && (
          <>
            <div>
              <p className="text-muted-foreground">Distance</p>
              <p className="font-medium">{formatMiles(data.trip.totalDistance)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Segments</p>
              <p className="font-medium">{data.trip.segments.length}</p>
            </div>
          </>
        )}
      </div>

      {/* Timeline */}
      {data.trip && (
        <>
          <Separator />
          <div className="space-y-2">
            <h2 className="font-semibold">Timeline</h2>
            <div className="space-y-1.5">
              {data.trip.segments.map((seg, i) => (
                <SegmentRow key={i} seg={seg} />
              ))}
            </div>
          </div>
        </>
      )}

      <Separator />

      {/* Delete */}
      <Dialog>
        <DialogTrigger render={<Button variant="destructive" size="sm" />}>
          <Trash2 className="mr-1 h-4 w-4" /> Delete trip
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete trip</DialogTitle>
            <DialogDescription>
              This will permanently delete the trip and invalidate the share link.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

function SegmentRow({ seg }: { seg: Segment }) {
  const duration = seg.tEnd - seg.tStart
  const start = formatShortDateTime(seg.tStart * 1000)

  if (seg.type === 'driving') {
    const distance = formatMiles(seg.distEnd - seg.distStart)
    return (
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="outline">Drive</Badge>
        <span className="text-muted-foreground">{start}</span>
        <span>{formatDuration(duration)}</span>
        <span className="text-muted-foreground">· {distance}</span>
      </div>
    )
  }

  const label =
    seg.reason === 'sleep'
      ? 'Sleep'
      : seg.reason === 'break'
        ? 'Break'
        : seg.reason === 'fuel'
          ? 'Fuel'
          : seg.reason === 'wait'
            ? 'Waiting'
            : 'Rest'
  return (
    <div className="flex items-center gap-2 text-sm">
      <Badge variant="secondary">{label}</Badge>
      <span className="text-muted-foreground">{start}</span>
      <span>{formatDuration(duration)}</span>
    </div>
  )
}
