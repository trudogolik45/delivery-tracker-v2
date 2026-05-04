import { createFileRoute, Outlet, redirect, Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { meQueryOptions, useAuth, useLogout } from '@/lib/auth'

export const Route = createFileRoute('/admin')({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(meQueryOptions)
    if (!user) {
      throw redirect({ to: '/login' })
    }
  },
  component: AdminLayout,
})

function AdminLayout() {
  const { data: user } = useAuth()
  const logout = useLogout()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link to="/admin" className="text-lg font-semibold">
          Delivery Tracker
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {user ? <span className="text-muted-foreground">{user.email}</span> : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Sign out
          </Button>
        </div>
      </header>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
