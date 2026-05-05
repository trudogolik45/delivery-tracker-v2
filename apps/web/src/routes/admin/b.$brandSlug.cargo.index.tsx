import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, ArrowLeft } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { apiJson, apiRequest } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { CargoWithPhotos } from '@delivery/schemas'

export const Route = createFileRoute('/admin/b/$brandSlug/cargo/')({
  component: CargoList,
})

function CargoList() {
  const { brandSlug } = Route.useParams()
  const qc = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', brandSlug, 'cargo'],
    queryFn: () => apiJson<CargoWithPhotos[]>(`/admin/b/${brandSlug}/cargo`),
  })

  const deleteMutation = useMutation({
    mutationFn: (cargoId: string) =>
      apiRequest(`/admin/b/${brandSlug}/cargo/${cargoId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', brandSlug, 'cargo'] }),
  })

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>
  if (error) return <div className="text-sm text-destructive">Failed to load cargo.</div>

  return (
    <div className="space-y-4">
      <Link
        to="/admin/b/$brandSlug/dashboard"
        params={{ brandSlug }}
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Back
      </Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cargo</h1>
        <Link
          to="/admin/b/$brandSlug/cargo/new"
          params={{ brandSlug }}
          className={buttonVariants({ size: 'sm' })}
        >
          <Plus className="mr-1 h-4 w-4" /> New cargo
        </Link>
      </div>

      {!data?.length ? (
        <p className="text-sm text-muted-foreground">No cargo yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Photos</TableHead>
              <TableHead>Custom fields</TableHead>
              <TableHead>Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.title}</TableCell>
                <TableCell>
                  <Badge variant="outline">{c.photoUploadIds.length}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{Object.keys(c.fields).length}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(c.createdAt)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Link
                      to="/admin/b/$brandSlug/cargo/$cargoId"
                      params={{ brandSlug, cargoId: c.id }}
                      className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Link>
                    <Dialog>
                      <DialogTrigger render={<Button variant="ghost" size="icon" />}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Delete cargo</DialogTitle>
                          <DialogDescription>
                            Delete «{c.title}»? This cannot be undone.
                          </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                          <Button
                            variant="destructive"
                            onClick={() => deleteMutation.mutate(c.id)}
                            disabled={deleteMutation.isPending}
                          >
                            Delete
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
