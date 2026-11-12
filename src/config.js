// Uygulama ayarları. Anahtarlar .env dosyasından (VITE_ önekiyle) gelir.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
// Web sürümünün herkese açık adresi (örn. https://voxen.example.com). Davet linkleri bununla kurulur;
// masaüstü programında bu yoksa link yerine sadece davet kodu kopyalanır.
export const PUBLIC_URL = import.meta.env.VITE_PUBLIC_URL ?? ''

// Sesli sohbette bağlantı kurmaya yardım eden ücretsiz STUN sunucuları
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
]

// Ses kalitesi varsayılanları
export const AUDIO_DEFAULTS = {
  bitrateKbps: 128,
  minBitrateKbps: 32,
  maxBitrateKbps: 128,
  fec: true,
}
