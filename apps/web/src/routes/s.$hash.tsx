import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/s/$hash')({
  component: () => {
    const { hash } = Route.useParams()
    return <div className="p-4">Tracking: {hash}</div>
  },
})
