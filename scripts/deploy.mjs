// Публикация dist в ветку gh-pages (GitHub Pages → Deploy from a branch → gh-pages).
import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
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
run('git', ['add', '-A'], dist)
run('git', ['commit', '-q', '-m', `Публикация ${commit}`], dist)
run('git', ['push', '-f', remote, 'gh-pages'], dist)
rmSync(join(dist, '.git'), { recursive: true, force: true })
console.log('\nОпубликовано: https://eekorchagin-cyber.github.io/DachaBook/')
