// Migration'ları Supabase'e gönderir. .env.test içindeki SUPABASE_DB_URL değerini okur.
// Windows'ta $VAR genişlemediği için npm script yerine bu dosya kullanılır.
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { buildPushArgs } from './db-push-lib.mjs'

if (!existsSync('.env.test')) {
  console.error('Hata: .env.test dosyası yok. .env.test.example dosyasını kopyalayıp doldur.')
  process.exit(1)
}

// "ANAHTAR=değer" satırlarını basitçe oku
let url
for (const line of readFileSync('.env.test', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*SUPABASE_DB_URL\s*=\s*(.*)$/)
  if (m) url = m[1].trim().replace(/^["']|["']$/g, '')
}
if (!url) {
  console.error('Hata: .env.test içinde SUPABASE_DB_URL tanımlı değil.')
  process.exit(1)
}

// Kabuk (cmd) kullanmadan, yerel supabase CLI'ı node ile doğrudan çalıştır.
// Böylece URL/şifredeki & % ^ | gibi karakterler bozulmaz.
const pkgPath = join(process.cwd(), 'node_modules', 'supabase', 'package.json')
if (!existsSync(pkgPath)) {
  console.error('Hata: supabase CLI kurulu değil. Önce `npm install` çalıştır.')
  process.exit(1)
}
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.supabase
const cli = join(dirname(pkgPath), bin)

const r = spawnSync(process.execPath, [cli, ...buildPushArgs(url)], { stdio: 'inherit' })
process.exit(r.status ?? 1)
