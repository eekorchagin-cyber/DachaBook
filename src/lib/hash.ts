export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(data: Blob | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : await data.arrayBuffer()
  return toHex(await crypto.subtle.digest('SHA-256', bytes))
}

/** Идентификатор в формате UUID, одинаковый на всех устройствах для одного ключа: стартовые данные не дублируются при восстановлении копии. */
export async function stableId(key: string): Promise<string> {
  const hex = await sha256Hex(key)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
