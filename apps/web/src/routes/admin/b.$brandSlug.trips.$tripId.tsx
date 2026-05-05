import { useState } from 'react'
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Check, Trash2, ArrowLeft } from 'lucide-react'
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
import { apiJson, apiRequest, API_BASE_URL } from '@/lib/api'
import { TripMap } from '@/components/TripMap'
import type { TripAdmin, Segment } from '@delivery/schemas'

export const Route = createFileRoute('/admin/b/$brandSlug/trips/$tripId')({
  component: TripDetail,
})

function TripDetail() {
  const { brandSlug, tripId } = Route.useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)

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

  async function copyShareUrl() {
    if (!data) return
    const shareUrl = `${API_BASE_URL}/share/${data.shareHash}`
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>
  if (error || !data) return <div className="text-sm text-destructive">Trip not found.</div>

  const shareUrl = `/s/${data.shareHash}`

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
              {window.location.origin}{shareUrl}
            </a>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={copyShareUrl}>
          {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
          {copied ? 'Copied!' : 'Copy link'}
        </Button>
      </div>

      {/* Trip meta */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Departure</p>
          <p className="font-medium">{new Date(data.startsAt).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Desired arrival</p>
          <p className="font-medium">{new Date(data.desiredArrival).toLocaleString()}</p>
        </div>
        {data.trip && (
          <>
            <div>
              <p className="text-muted-foreground">Distance</p>
              <p className="font-medium">{(data.trip.totalDistance / 1000).toFixed(0)} km</p>
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
  const start = new Date(seg.tStart * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  if (seg.type === 'driving') {
    const km = ((seg.distEnd - seg.distStart) / 1000).toFixed(0)
    return (
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="outline">Drive</Badge>
        <span className="text-muted-foreground">{start}</span>
        <span>{formatDuration(duration)}</span>
        <span className="text-muted-foreground">· {km} km</span>
      </div>
    )
  }

  const label =
    seg.reason === 'sleep' ? 'Sleep' : seg.reason === 'break' ? 'Break' : 'Rest'
  return (
    <div className="flex items-center gap-2 text-sm">
      <Badge variant="secondary">{label}</Badge>
      <span className="text-muted-foreground">{start}</span>
      <span>{formatDuration(duration)}</span>
    </div>
  )
}
