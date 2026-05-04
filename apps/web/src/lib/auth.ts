import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  LoginInputSchema,
  LoginResponseSchema,
  MeResponseSchema,
  type LoginInput,
  type UserPublic,
} from '@delivery/schemas'
import { apiJson, apiRequest, ApiError } from './api.js'

export const meQueryKey = ['auth', 'me'] as const

export const meQueryOptions = queryOptions({
  queryKey: meQueryKey,
  queryFn: async (): Promise<UserPublic | null> => {
    const response = await apiRequest('/auth/me')
    if (response.status === 401) return null
    if (!response.ok) {
      throw new ApiError(response.status, response.statusText)
    }
    const data = await response.json()
    return MeResponseSchema.parse(data).user
  },
  staleTime: 60_000,
})

export function useAuth() {
  return useQuery(meQueryOptions)
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: LoginInput): Promise<UserPublic> => {
      const parsed = LoginInputSchema.parse(input)
      const data = await apiJson('/auth/login', { method: 'POST', body: parsed })
      return LoginResponseSchema.parse(data).user
    },
    onSuccess: (user) => {
      queryClient.setQueryData(meQueryKey, user)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<void> => {
      await apiRequest('/auth/logout', { method: 'POST' })
    },
    onSuccess: () => {
      queryClient.setQueryData(meQueryKey, null)
    },
  })
}
