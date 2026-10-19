export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(data: Blob | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : await data.arrayBuffer()
  return toHex(await crypto.subtle.digest('SHA-256', bytes))
}
