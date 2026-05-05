import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { apiJson } from '@/lib/api'

export type GeoPoint = { label: string; lat: number; lng: number }

interface GeoSearchProps {
  value: GeoPoint | null
  onChange: (point: GeoPoint) => void
  placeholder?: string
  disabled?: boolean
}

export function GeoSearch({ value, onChange, placeholder, disabled }: GeoSearchProps) {
  const [query, setQuery] = useState(value?.label ?? '')
  const [suggestions, setSuggestions] = useState<GeoPoint[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(value?.label ?? '')
  }, [value])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleInput(raw: string) {
    setQuery(raw)
    if (timer.current) clearTimeout(timer.current)
    if (raw.length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }
    timer.current = setTimeout(async () => {
      const results = await apiJson<GeoPoint[]>(`/admin/geocode?q=${encodeURIComponent(raw)}`)
      setSuggestions(results)
      setOpen(results.length > 0)
    }, 300)
  }

  function select(point: GeoPoint) {
    setQuery(point.label)
    setSuggestions([])
    setOpen(false)
    onChange(point)
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        placeholder={placeholder ?? 'Search address…'}
        disabled={disabled}
        autoComplete="off"
      />
      {open && (
        <ul className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          {suggestions.map((s, i) => (
            <li
              key={i}
              className="cursor-pointer px-3 py-2 text-sm hover:bg-accent"
              onMouseDown={() => select(s)}
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
