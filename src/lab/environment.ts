export interface Environment {
  version: string
  userAgent: string
  standalone: boolean
  secureContext: boolean
  serviceWorker: boolean
  storageQuota?: number
  storageUsage?: number
  persisted?: boolean
  screen: string
}

export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches
}

export async function readEnvironment(): Promise<Environment> {
  const env: Environment = {
    version: __APP_VERSION__,
    userAgent: navigator.userAgent,
    standalone: isStandalone(),
    secureContext: window.isSecureContext,
    serviceWorker: 'serviceWorker' in navigator,
    screen: `${window.screen.width}×${window.screen.height} @${window.devicePixelRatio}x`,
  }
  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate()
    env.storageQuota = estimate.quota
    env.storageUsage = estimate.usage
  }
  if (navigator.storage?.persisted) env.persisted = await navigator.storage.persisted()
  return env
}
