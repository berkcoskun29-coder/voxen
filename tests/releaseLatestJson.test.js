import { describe, it, expect } from 'vitest'
import { buildLatestJson } from '../scripts/release-latest-json-lib.mjs'

describe('buildLatestJson', () => {
  it('Tauri v2 güncelleyici biçimini üretir', () => {
    const j = buildLatestJson({
      version: '0.1.0', notes: 'ilk', exeName: 'Voxen_0.1.0_x64-setup.exe',
      signature: 'SAHTE-IMZA\n', pubDate: '2026-11-12T10:00:00Z',
    })
    expect(j).toEqual({
      version: '0.1.0', notes: 'ilk', pub_date: '2026-11-12T10:00:00.000Z',
      platforms: { 'windows-x86_64': {
        signature: 'SAHTE-IMZA',
        url: 'https://github.com/berkcoskun29-coder/voxen/releases/download/v0.1.0/Voxen_0.1.0_x64-setup.exe',
      } },
    })
  })
})
