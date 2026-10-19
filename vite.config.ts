/// <reference types="vitest/config" />
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }

function buildStamp(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

const appVersion = `${pkg.version}+${buildStamp()}`

/** Собирает sw.js со списком всех файлов сборки, чтобы приложение открывалось без сети. */
function offlineServiceWorker(): Plugin {
  return {
    name: 'offline-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const template = readFileSync(join(root, 'src/sw/sw-template.js'), 'utf8')
      const assets = Object.keys(bundle).filter((file) => !file.endsWith('.map'))
      const publicFiles = readdirSync(join(root, 'public')).filter((file) => !file.startsWith('.'))
      const files = ['./', ...[...publicFiles, ...assets].map((file) => `./${file}`)]
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('__VERSION__', appVersion)
          .replace('"__FILES__"', JSON.stringify(files)),
      })
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version: appVersion })}\n`,
      })
    },
  }
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react(), offlineServiceWorker()],
  server: {
    host: true,
    port: 5174,
    strictPort: true,
  },
  test: {
    environment: 'node',
  },
})
