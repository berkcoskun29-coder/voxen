// Kullanım: node scripts/release-latest-json.mjs ["sürüm notu"]
// src-tauri/target/release/bundle/nsis/ içindeki *-setup.exe ve .sig dosyasından latest.json yazar (aynı klasöre).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildLatestJson } from './release-latest-json-lib.mjs'

const dir = join('src-tauri', 'target', 'release', 'bundle', 'nsis')
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const exeName = readdirSync(dir).find((f) => f.endsWith('.exe') && f.includes(version))
if (!exeName) throw new Error(`${dir} içinde ${version} sürümlü .exe yok (önce npx tauri build)`)
const signature = readFileSync(join(dir, `${exeName}.sig`), 'utf8')
const json = buildLatestJson({ version, notes: process.argv[2] ?? '', exeName, signature })
const out = join(dir, 'latest.json')
writeFileSync(out, JSON.stringify(json, null, 2) + '\n')
console.log(`yazıldı: ${out}`)
