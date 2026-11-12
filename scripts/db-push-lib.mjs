// Küçük yardımcı: supabase CLI'a verilecek argümanlar.
// URL tek parça olarak kalır (içinde & % ^ | olsa bile değişmez).
export function buildPushArgs(url) {
  return ['db', 'push', '--db-url', url]
}
