// Tauri v2 güncelleyici için latest.json içeriğini üretir.
export const REPO = 'berkcoskun29-coder/voxen'

export function buildLatestJson({ version, notes = '', exeName, signature, pubDate = new Date(), repo = REPO }) {
  return {
    version,
    notes,
    pub_date: new Date(pubDate).toISOString(),
    platforms: {
      'windows-x86_64': {
        signature: signature.trim(),
        url: `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(exeName)}`,
      },
    },
  }
}
