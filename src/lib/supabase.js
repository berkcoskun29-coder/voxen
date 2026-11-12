// Tüm uygulamanın kullandığı tek Supabase istemcisi.
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js'
import { captureRecoveryFromUrl } from '../auth/recovery.js'

// Süresi dolmuş/geçersiz e-posta linkinden dönüldüyse hatayı yakala (istemci adresi temizlemeden ÖNCE)
captureRecoveryFromUrl()

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
