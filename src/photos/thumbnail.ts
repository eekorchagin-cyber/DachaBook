export interface Thumbnail {
  blob: Blob
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close(): void }> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch {
      // Safari старых версий не принимает параметры — пробуем через <img>.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => undefined }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Уменьшенная копия JPEG; исходный файл не изменяется. */
export async function makeThumbnail(file: Blob, maxSide = 640, quality = 0.8): Promise<Thumbnail> {
  const image = await decode(file)
  try {
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D недоступен')
    context.drawImage(image.source, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Не удалось создать JPEG'))), 'image/jpeg', quality),
    )
    return { blob, width, height, sourceWidth: image.width, sourceHeight: image.height }
  } finally {
    image.close()
  }
}
