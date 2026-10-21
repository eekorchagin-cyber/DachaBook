// Публикация dist в ветку gh-pages (GitHub Pages → Deploy from a branch → gh-pages).
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const dist = join(root, 'dist')
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit' })
const read = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim()

const remote = read('git', ['remote', 'get-url', 'origin'])
const commit = read('git', ['rev-parse', '--short', 'HEAD'])

run('npm', ['run', 'build'])
writeFileSync(join(dist, '.nojekyll'), '')
rmSync(join(dist, '.git'), { recursive: true, force: true })
run('git', ['init', '-q', '-b', 'gh-pages'], dist)
// Файлы прошлых сборок остаются на сайте: страница, открытая из офлайн-копии старой версии,
// должна суметь догрузить свои скрипты.
// DEPLOY_FRESH=1 — публикация без файлов прошлых сборок (например, чтобы убрать с сайта устаревшее содержимое).
if (process.env.DEPLOY_FRESH) console.log('Публикация начисто: файлы прошлых сборок не переносятся')
else try {
  run('git', ['fetch', '-q', '--depth=1', remote, 'gh-pages'], dist)
  const previous = execFileSync('git', ['ls-tree', '-r', '--name-only', 'FETCH_HEAD', 'assets'], { cwd: dist, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file && !existsSync(join(dist, file)))
  if (previous.length > 0) run('git', ['checkout', 'FETCH_HEAD', '--', ...previous], dist)
} catch {
  console.warn('Прошлая публикация не найдена — публикуется только текущая сборка')
}
run('git', ['add', '-A'], dist)
run('git', ['commit', '-q', '-m', `Публикация ${commit}`], dist)
run('git', ['push', '-f', remote, 'gh-pages'], dist)
rmSync(join(dist, '.git'), { recursive: true, force: true })
console.log('\nОпубликовано: https://eekorchagin-cyber.github.io/DachaBook/')
