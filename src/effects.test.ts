import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

describe('эффекты React', () => {
  // Результат выражения React считает функцией очистки. В Chrome 155 window.scrollTo возвращает Promise,
  // и запись useEffect(() => window.scrollTo(...)) давала пустой экран при смене экрана.
  it('не возвращают результат выражения вместо функции очистки', () => {
    const offenders = sourceFiles(import.meta.dirname).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ line: line.trim(), where: `${file}:${index + 1}` }))
        .filter(({ line }) => /use(Layout)?Effect\(\(\) => [^{(]/.test(line))
        .map(({ where, line }) => `${where}: ${line}`),
    )
    expect(offenders).toEqual([])
  })
})
