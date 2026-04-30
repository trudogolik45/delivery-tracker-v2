import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { BrandsArraySchema } from '@delivery/schemas'

export const Route = createFileRoute('/admin/')({
  component: AdminIndex,
})

function AdminIndex() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const r = await fetch('http://localhost:3000/brands')
      return BrandsArraySchema.parse(await r.json())
    },
  })

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {String(error)}</div>
  return (
    <ul>
      {data?.map((b) => <li key={b.id}>{b.name}</li>)}
    </ul>
  )
}
