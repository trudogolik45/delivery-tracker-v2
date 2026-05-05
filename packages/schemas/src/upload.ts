import { z } from 'zod'

export const UploadResponseSchema = z.object({
  uploadId: z.uuid(),
  url: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
})
export type UploadResponse = z.infer<typeof UploadResponseSchema>
