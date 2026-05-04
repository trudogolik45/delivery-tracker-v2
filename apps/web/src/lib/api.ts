export const API_BASE_URL = 'http://localhost:3000'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH'
  body?: unknown
}

export async function apiRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = 'GET', body } = options
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  return response
}

export async function apiJson<T>(
  path: string,
  options: RequestOptions = {},
  parser?: (data: unknown) => T,
): Promise<T> {
  const response = await apiRequest(path, options)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new ApiError(response.status, text || response.statusText)
  }
  const data = await response.json()
  return parser ? parser(data) : (data as T)
}
