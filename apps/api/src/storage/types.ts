export interface Storage {
  put(key: string, data: Buffer, mime: string): Promise<void>
  url(key: string): string
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}
