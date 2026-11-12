// Web sürümünü Cloudflare Pages'e yükler (proje: voxen-sohbet).
// Kullanım: npm run deploy:web
// 1) npm run build  2) wrangler'ı BOŞ bir klasörden çalıştırır: proje kökünden çalışırsa
//    wrangler kendi ayarlarını package.json'a eklemeye kalkıyor.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const kok = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const calistir = (komut, argumanlar, cwd) => {
  const r = spawnSync(komut, argumanlar, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

calistir('npm', ['run', 'build'], kok)
const dist = path.join(kok, 'dist')
for (const f of ['_headers', '_redirects']) {
  if (!fs.existsSync(path.join(dist, f))) { console.error(`dist/${f} yok; public/ klasörünü kontrol et.`); process.exit(1) }
}
const bos = fs.mkdtempSync(path.join(os.tmpdir(), 'voxen-deploy-'))
calistir('npx', ['wrangler@4.161.0', 'pages', 'deploy', dist, '--project-name', 'voxen-sohbet', '--branch', 'main'], bos)
fs.rmSync(bos, { recursive: true, force: true })
console.log('Yüklendi: https://voxen-sohbet.pages.dev')
