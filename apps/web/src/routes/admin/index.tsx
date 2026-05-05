import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Check, RefreshCw, Globe } from 'lucide-react'
import {
  BrandsArraySchema,
  type Brand,
  type BrandCreate,
  type BrandDnsStatus,
} from '@delivery/schemas'
import { apiJson, apiRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export const Route = createFileRoute('/admin/')({
  component: AdminIndex,
})

function AdminIndex() {
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'brands'],
    queryFn: () => apiJson('/admin/brands', {}, (raw) => BrandsArraySchema.parse(raw)),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Brands</h1>
          <p className="text-sm text-muted-foreground">
            Each brand gets its own share domain.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="mr-1 h-4 w-4" /> New brand
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="text-sm text-destructive">Error: {String(error)}</div>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No brands yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((brand) => (
            <BrandCard key={brand.id} brand={brand} />
          ))}
        </div>
      )}

      <CreateBrandDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function BrandCard({ brand }: { brand: Brand }) {
  const dnsQuery = useQuery({
    queryKey: ['admin', 'brands', brand.slug, 'dns'],
    queryFn: () => apiJson<BrandDnsStatus>(`/admin/brands/${brand.slug}/dns-status`),
    staleTime: 30_000,
  })

  return (
    <Link
      to="/admin/b/$brandSlug/dashboard"
      params={{ brandSlug: brand.slug }}
      className="rounded-lg border bg-card p-4 shadow-sm transition hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold">{brand.name}</div>
          <div className="truncate text-sm text-muted-foreground">{brand.slug}</div>
        </div>
        <DnsBadge status={dnsQuery.data} loading={dnsQuery.isLoading} />
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Globe className="h-3 w-3 shrink-0" />
        <span className="truncate">{brand.shareDomain}</span>
      </div>
    </Link>
  )
}

function DnsBadge({ status, loading }: { status: BrandDnsStatus | undefined; loading: boolean }) {
  if (loading) {
    return <Badge variant="outline">DNS…</Badge>
  }
  if (status?.resolved) {
    return (
      <Badge variant="default" className="shrink-0">
        <Check className="mr-1 h-3 w-3" /> DNS OK
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="shrink-0">
      DNS pending
    </Badge>
  )
}

function CreateBrandDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [shareDomain, setShareDomain] = useState('')
  const [createdBrand, setCreatedBrand] = useState<Brand | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: async (body: BrandCreate): Promise<Brand> => {
      const res = await apiRequest('/admin/brands', { method: 'POST', body })
      const data = await res.json()
      if (!res.ok) {
        const msg = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
        throw new Error(msg)
      }
      return data as Brand
    },
    onSuccess: (brand) => {
      qc.invalidateQueries({ queryKey: ['admin', 'brands'] })
      setCreatedBrand(brand)
      setErrorMsg(null)
    },
    onError: (err) => setErrorMsg(String(err.message ?? err)),
  })

  function reset() {
    setSlug('')
    setName('')
    setShareDomain('')
    setCreatedBrand(null)
    setErrorMsg(null)
  }

  function handleClose(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg(null)
    createMutation.mutate({
      slug: slug.trim(),
      name: name.trim(),
      shareDomain: shareDomain.trim(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        {createdBrand ? (
          <CreatedBrandPanel brand={createdBrand} onDone={() => handleClose(false)} />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>New brand</DialogTitle>
              <DialogDescription>
                Pick a slug for the admin URL, a display name, and the share domain
                customers will use.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="brand-name">Display name *</Label>
              <Input
                id="brand-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Timeless Drive"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="brand-slug">Slug *</Label>
              <Input
                id="brand-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="timelessdrivecars"
                pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
                required
              />
              <p className="text-xs text-muted-foreground">
                Used in admin URL: /admin/b/&lt;slug&gt;
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="brand-domain">Share domain *</Label>
              <Input
                id="brand-domain"
                value={shareDomain}
                onChange={(e) => setShareDomain(e.target.value.toLowerCase())}
                placeholder="delivery.timelessdrivecars.com"
                required
              />
              <p className="text-xs text-muted-foreground">
                Customers will see https://&lt;share-domain&gt;/s/&lt;hash&gt;.
              </p>
            </div>

            {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleClose(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create brand'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CreatedBrandPanel({ brand, onDone }: { brand: Brand; onDone: () => void }) {
  const qc = useQueryClient()
  const dnsQuery = useQuery({
    queryKey: ['admin', 'brands', brand.slug, 'dns'],
    queryFn: () => apiJson<BrandDnsStatus>(`/admin/brands/${brand.slug}/dns-status`),
    staleTime: 0,
  })

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Brand created</DialogTitle>
        <DialogDescription>
          {brand.name} (/admin/b/{brand.slug}) is ready in the admin panel.
        </DialogDescription>
      </DialogHeader>

      <div className="rounded-md border p-4 space-y-3 text-sm">
        <p className="font-medium">Configure DNS for the share domain</p>
        <p className="text-muted-foreground">
          Point{' '}
          <code className="rounded bg-muted px-1 py-0.5">{brand.shareDomain}</code>{' '}
          at the admin host using either:
        </p>
        <ul className="list-disc pl-5 text-muted-foreground space-y-1">
          <li>
            <strong>A record</strong> → the same IP as the admin host (works for any
            domain, including apex roots).
          </li>
          <li>
            <strong>CNAME record</strong> →{' '}
            <code className="rounded bg-muted px-1 py-0.5">
              {window.location.host}
            </code>{' '}
            (only valid for subdomains; root domains require A).
          </li>
        </ul>
        <p className="text-muted-foreground">
          Once DNS propagates, Caddy issues the TLS certificate automatically and{' '}
          https://{brand.shareDomain}/s/&lt;hash&gt; starts working.
        </p>
        <DnsCheckRow status={dnsQuery.data} loading={dnsQuery.isFetching} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            qc.invalidateQueries({ queryKey: ['admin', 'brands', brand.slug, 'dns'] })
          }
          disabled={dnsQuery.isFetching}
        >
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Re-check DNS
        </Button>
      </div>

      <DialogFooter>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </div>
  )
}

function DnsCheckRow({
  status,
  loading,
}: {
  status: BrandDnsStatus | undefined
  loading: boolean
}) {
  if (loading || !status) {
    return <p className="text-xs text-muted-foreground">Checking DNS…</p>
  }
  if (status.resolved) {
    return (
      <p className="text-xs text-foreground">
        <Check className="mr-1 inline h-3 w-3" />
        DNS resolves to {status.actual.join(', ')} — matches expected.
      </p>
    )
  }
  if (status.actual.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        DNS record not found yet. Allow up to a few minutes for propagation.
      </p>
    )
  }
  return (
    <p className="text-xs text-muted-foreground">
      DNS resolves to {status.actual.join(', ')}, expected {status.expected.join(', ')}.
    </p>
  )
}
