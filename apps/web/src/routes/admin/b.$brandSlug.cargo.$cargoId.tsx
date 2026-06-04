import { useState, useRef } from 'react'
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Upload, ArrowLeft } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiJson, API_BASE_URL } from '@/lib/api'
import type { CargoWithPhotos, CargoUpdate, UploadResponse } from '@delivery/schemas'

export const Route = createFileRoute('/admin/b/$brandSlug/cargo/$cargoId')({
  component: CargoEdit,
})

type FieldRow = { key: string; value: string }
type Photo = { uploadId: string; url: string }

function CargoEdit() {
  const { brandSlug, cargoId } = Route.useParams()

  const { data, isLoading } = useQuery({
    queryKey: ['admin', brandSlug, 'cargo', cargoId],
    queryFn: () => apiJson<CargoWithPhotos>(`/admin/b/${brandSlug}/cargo/${cargoId}`),
  })

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>
  if (!data) return <div className="text-sm text-destructive">Cargo not found.</div>

  return <CargoEditForm brandSlug={brandSlug} cargoId={cargoId} initial={data} />
}

function CargoEditForm({
  brandSlug,
  cargoId,
  initial,
}: {
  brandSlug: string
  cargoId: string
  initial: CargoWithPhotos
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [title, setTitle] = useState(() => initial.title)
  const [fields, setFields] = useState<FieldRow[]>(() =>
    Object.entries(initial.fields).map(([key, value]) => ({ key, value })),
  )
  const [photos, setPhotos] = useState<Photo[]>(() =>
    initial.photoUploadIds.map((id, i) => ({ uploadId: id, url: initial.photoUrls[i] ?? '' })),
  )
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const updateMutation = useMutation({
    mutationFn: (body: CargoUpdate) =>
      apiJson<CargoWithPhotos>(`/admin/b/${brandSlug}/cargo/${cargoId}`, { method: 'PUT', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', brandSlug, 'cargo'] })
      navigate({ to: '/admin/b/$brandSlug/cargo', params: { brandSlug } })
    },
  })

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${API_BASE_URL}/admin/b/${brandSlug}/uploads`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      if (!res.ok) throw new Error(await res.text())
      const uploadData = (await res.json()) as UploadResponse
      setPhotos((prev) => [...prev, { uploadId: uploadData.uploadId, url: uploadData.url }])
    } catch (err) {
      alert(`Upload failed: ${err}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function addField() {
    setFields((prev) => [...prev, { key: '', value: '' }])
  }

  function updateField(i: number, k: keyof FieldRow, v: string) {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, [k]: v } : f)))
  }

  function removeField(i: number) {
    setFields((prev) => prev.filter((_, idx) => idx !== i))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fieldsObj = Object.fromEntries(
      fields.filter((f) => f.key.trim()).map((f) => [f.key.trim(), f.value]),
    )
    updateMutation.mutate({
      title: title.trim(),
      fields: fieldsObj,
      photoUploadIds: photos.map((p) => p.uploadId),
    })
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Link
        to="/admin/b/$brandSlug/cargo"
        params={{ brandSlug }}
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Back
      </Link>
      <h1 className="text-2xl font-bold">Edit cargo</h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="title">Title *</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Custom fields</Label>
            <Button type="button" variant="outline" size="sm" onClick={addField}>
              <Plus className="mr-1 h-3 w-3" /> Add field
            </Button>
          </div>
          {fields.map((f, i) => (
            <div key={i} className="flex gap-2">
              <Input
                placeholder="Key"
                value={f.key}
                onChange={(e) => updateField(i, 'key', e.target.value)}
              />
              <Input
                placeholder="Value"
                value={f.value}
                onChange={(e) => updateField(i, 'value', e.target.value)}
              />
              <Button type="button" variant="ghost" size="icon" onClick={() => removeField(i)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label>Photos</Label>
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative">
                <img src={p.url} alt="" className="h-20 w-20 rounded-md object-cover border" />
                <button
                  type="button"
                  onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex h-20 w-20 items-center justify-center rounded-md border-2 border-dashed text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
            >
              <Upload className="h-5 w-5" />
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        <div className="flex gap-3">
          <Button type="submit" disabled={!title.trim() || updateMutation.isPending}>
            {updateMutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/admin/b/$brandSlug/cargo', params: { brandSlug } })}
          >
            Cancel
          </Button>
        </div>
        {updateMutation.error && (
          <p className="text-sm text-destructive">{String(updateMutation.error)}</p>
        )}
      </form>
    </div>
  )
}
