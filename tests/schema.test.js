// Çevrimdışı şema testi: SQL dosyasında beklenen parçalar var mı?
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/001_init.sql', 'utf8').toLowerCase()

describe('001_init.sql', () => {
  for (const t of ['profiles', 'servers', 'server_members', 'channels', 'messages']) {
    it(`${t} tablosu ve RLS`, () => {
      expect(sql).toContain(`create table public.${t}`)
      expect(sql).toContain(`alter table public.${t} enable row level security`)
    })
  }
  it('mesaj uzunluk kısıtı', () => expect(sql).toContain('length(content) between 1 and 2000'))
  it('kanal türü kısıtı', () => expect(sql).toContain("kind in ('text','voice')"))
  it('RPC fonksiyonları', () => {
    expect(sql).toContain('function public.create_server')
    expect(sql).toContain('function public.join_server_by_invite')
  })
  it('messages realtime yayınında', () =>
    expect(sql).toContain('alter publication supabase_realtime add table public.messages'))

  it('politika adları', () => {
    for (const n of ['profiles_select', 'profiles_insert', 'profiles_update', 'servers_select',
      'members_select', 'channels_select', 'channels_insert', 'channels_delete',
      'messages_select', 'messages_insert']) {
      expect(sql).toContain(`create policy ${n} on public.`)
    }
  })
  it('security definer ve search_path', () => {
    expect(sql).toContain('security definer')
    expect(sql).toContain('set search_path = public')
  })
  it('avatars deposu ve politikaları', () => {
    expect(sql).toContain("insert into storage.buckets (id, name, public)")
    expect(sql).toContain("values ('avatars', 'avatars', true)")
    for (const n of ['avatars_insert', 'avatars_select', 'avatars_update']) {
      expect(sql).toContain(`create policy ${n} on storage.objects`)
    }
    const upd = sql.slice(sql.indexOf('create policy avatars_update'))
    expect(upd).toContain('with check')
  })
})

// 002: kullanıcı adı denetimi + avatar adresi
const sql2 = readFileSync('supabase/migrations/002_profiles_avatar.sql', 'utf8').toLowerCase()
describe('002_profiles_avatar.sql', () => {
  it('avatar_url sütunu', () =>
    expect(sql2).toContain('add column avatar_url text'))
  it('username_available güvenli fonksiyon ve anon izni', () => {
    expect(sql2).toContain('function public.username_available')
    expect(sql2).toContain('security definer')
    expect(sql2).toContain('set search_path = public')
    expect(sql2).toMatch(/grant execute on function public\.username_available\(text\) to anon, authenticated/)
  })
})

// 003: sesli kanal sinyali (voice:<kanal>) yalnızca o sunucunun üyelerine açık
import { existsSync } from 'node:fs'
const yol3 = 'supabase/migrations/003_realtime_voice_auth.sql'
const sql3 = existsSync(yol3) ? readFileSync(yol3, 'utf8').toLowerCase().replace(/\s+/g, ' ') : ''
describe('003_realtime_voice_auth.sql', () => {
  it('dosya var', () => expect(existsSync(yol3)).toBe(true))
  it('konu denetimi: güvenli fonksiyon, geçersiz uuid için false', () => {
    expect(sql3).toContain('function public.can_access_voice_topic(topic text)')
    expect(sql3).toContain('security definer')
    expect(sql3).toContain('set search_path = public')
    // uuid biçimi önce düzenli ifadeyle denetlenir: bozuk konu hata değil, false verir
    expect(sql3).toMatch(/!~\* '\^voice:\[0-9a-f\]\{8\}-/)
    expect(sql3).toContain("kind = 'voice'")
    expect(sql3).toContain('public.is_member(c.server_id)')
  })
  it('fonksiyon sadece giriş yapmış kullanıcılara açık', () => {
    expect(sql3).toContain('revoke all on function public.can_access_voice_topic(text) from public')
    expect(sql3).toContain('grant execute on function public.can_access_voice_topic(text) to authenticated')
  })
  it('realtime.messages: alma (select) ve gönderme (insert) politikaları', () => {
    expect(sql3).toContain('create policy voice_receive on realtime.messages for select to authenticated')
    expect(sql3).toContain('create policy voice_send on realtime.messages for insert to authenticated')
    const al = sql3.slice(sql3.indexOf('create policy voice_receive'))
    expect(al).toContain('public.can_access_voice_topic(realtime.topic())')
    expect(al).toContain("extension in ('broadcast', 'presence')")
    const gonder = sql3.slice(sql3.indexOf('create policy voice_send'))
    expect(gonder).toContain('with check')
    expect(gonder).toContain('public.can_access_voice_topic(realtime.topic())')
  })
})

// 004: varlık kanalı yalnızca giriş yapmışlara açık + profil kısıtları
const yol4 = 'supabase/migrations/004_presence_auth_and_checks.sql'
const sql4 = existsSync(yol4) ? readFileSync(yol4, 'utf8').toLowerCase().replace(/\s+/g, ' ') : ''
describe('004_presence_auth_and_checks.sql', () => {
  it('dosya var', () => expect(existsSync(yol4)).toBe(true))
  it('presence:voxen için alma (select) ve gönderme (insert) politikaları, sadece authenticated', () => {
    expect(sql4).toContain('create policy presence_receive on realtime.messages for select to authenticated')
    expect(sql4).toContain('create policy presence_send on realtime.messages for insert to authenticated')
    const al = sql4.slice(sql4.indexOf('create policy presence_receive'), sql4.indexOf('create policy presence_send'))
    expect(al).toContain("realtime.messages.extension = 'presence'")
    expect(al).toContain("realtime.topic() = 'presence:voxen'")
    const gonder = sql4.slice(sql4.indexOf('create policy presence_send'))
    expect(gonder).toContain('with check')
    expect(gonder).toContain("realtime.messages.extension = 'presence'")
    expect(gonder).toContain("realtime.topic() = 'presence:voxen'")
  })
  it('renk kısıtı (#rrggbb) ve palet varsayılanı', () => {
    expect(sql4).toContain("add constraint profiles_color_hex check (color ~ '^#[0-9a-fa-f]{6}$')")
    expect(sql4).toContain("alter column color set default '#3be37a'")
    expect(sql4).not.toMatch(/not valid/) // mevcut satırlar uygun: kısıt doğrulanarak eklenir
  })
  it('avatar adresi: boş ya da supabase avatars deposu', () => {
    expect(sql4).toContain('add constraint profiles_avatar_url_storage check')
    expect(sql4).toContain('avatar_url is null')
    expect(sql4).toContain("'^https://[a-z0-9]+\\.supabase\\.co/storage/v1/object/public/avatars/'")
  })
  it('kullanıcı adı büyük/küçük harf duyarsız benzersiz', () => {
    expect(sql4).toContain('create unique index profiles_username_lower_key on public.profiles (lower(username))')
  })
})
