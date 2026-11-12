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

// 005: sesli kanal durumu ayrı tabloda (varlık sınırına takılmasın diye presence'tan çıktı)
const yol5 = 'supabase/migrations/005_voice_states.sql'
const sql5 = existsSync(yol5) ? readFileSync(yol5, 'utf8').toLowerCase().replace(/\s+/g, ' ') : ''
describe('005_voice_states.sql', () => {
  it('dosya var', () => expect(existsSync(yol5)).toBe(true))
  it('tablo: kişi başı tek satır, sunucu/kanal silinince satır da silinir', () => {
    expect(sql5).toContain('create table public.voice_states')
    expect(sql5).toContain('user_id uuid primary key references auth.users on delete cascade')
    expect(sql5).toContain('server_id uuid not null references public.servers on delete cascade')
    expect(sql5).toContain('channel_id uuid not null references public.channels on delete cascade')
    expect(sql5).toContain('client_id text not null')
    for (const s of ['muted', 'deafened', 'camera', 'screen']) {
      expect(sql5).toContain(`${s} boolean not null default false`)
    }
    expect(sql5).toContain('updated_at timestamptz not null default now()')
  })
  it('RLS açık; okuma üyelere', () => {
    expect(sql5).toContain('alter table public.voice_states enable row level security')
    const sec = sql5.slice(sql5.indexOf('create policy voice_states_select'), sql5.indexOf('create policy voice_states_insert'))
    expect(sec).toContain('for select to authenticated')
    expect(sec).toContain('public.is_member(server_id)')
  })
  it('ekleme/güncelleme: kendi satırı + üyelik + kanal o sunucunun sesli kanalı', () => {
    for (const [ad, son] of [['voice_states_insert', 'create policy voice_states_update'], ['voice_states_update', 'create policy voice_states_delete']]) {
      const p = sql5.slice(sql5.indexOf(`create policy ${ad}`), sql5.indexOf(son))
      expect(p).toContain('with check')
      expect(p).toContain('user_id = auth.uid()')
      expect(p).toContain('public.is_member(server_id)')
      expect(p).toContain('public.is_voice_channel_of(channel_id, server_id)')
    }
    const guncelle = sql5.slice(sql5.indexOf('create policy voice_states_update'))
    expect(guncelle).toMatch(/using \(user_id = auth\.uid\(\)\)/)
  })
  it('kanal denetimi: güvenli fonksiyon, kind = voice ve sunucu eşleşmesi', () => {
    expect(sql5).toContain('function public.is_voice_channel_of(cid uuid, sid uuid)')
    const f = sql5.slice(sql5.indexOf('function public.is_voice_channel_of'), sql5.indexOf('revoke all'))
    expect(f).toContain('security definer')
    expect(f).toContain('set search_path = public')
    expect(f).toContain("c.kind = 'voice'")
    expect(f).toContain('c.server_id = sid')
    expect(sql5).toContain('revoke all on function public.is_voice_channel_of(uuid, uuid) from public')
    expect(sql5).toContain('grant execute on function public.is_voice_channel_of(uuid, uuid) to authenticated')
  })
  it('silme: yalnız kendi satırı', () => {
    const p = sql5.slice(sql5.indexOf('create policy voice_states_delete'))
    expect(p).toContain('for delete to authenticated')
    expect(p).toContain('using (user_id = auth.uid())')
  })
  it('updated_at sunucuda yenilenir', () => {
    expect(sql5).toContain('before update on public.voice_states')
    expect(sql5).toContain('new.updated_at := now()')
  })
  it('realtime yayınında; silme olayları için replica identity full', () => {
    expect(sql5).toContain('alter table public.voice_states replica identity full')
    expect(sql5).toContain('alter publication supabase_realtime add table public.voice_states')
  })
})

// 006: temel özellikler (düzenleme/silme, sunucu/kanal yönetimi, okunmamış, yazıyor, sunucu olayları)
const yol6 = 'supabase/migrations/006_temel_ozellikler.sql'
const sql6 = existsSync(yol6) ? readFileSync(yol6, 'utf8').toLowerCase().replace(/\s+/g, ' ') : ''
// Bir fonksiyonun tanımı (create ... $$ gövde $$;)
const fonk6 = (ad) => {
  const i = sql6.indexOf(`create or replace function public.${ad}(`)
  if (i < 0) return ''
  const govdeBasi = sql6.indexOf('$$', i)
  return sql6.slice(i, sql6.indexOf('$$;', govdeBasi + 2) + 3)
}
describe('006_temel_ozellikler.sql', () => {
  it('dosya var', () => expect(existsSync(yol6)).toBe(true))
  it('mesaj sütunları ve yeni içerik kuralı', () => {
    expect(sql6).toContain('add column if not exists edited_at timestamptz')
    expect(sql6).toContain('add column if not exists deleted_at timestamptz')
    expect(sql6).toContain("(deleted_at is null and length(content) between 1 and 2000) or (deleted_at is not null and content = '')")
  })
  it('messages_insert sıkılaştı: yeni satır silinmiş/düzenlenmiş olamaz', () => {
    const p = sql6.slice(sql6.indexOf('create policy messages_insert'), sql6.indexOf('create or replace function public.edit_message'))
    expect(p).toContain('author_id = auth.uid()')
    expect(p).toContain('deleted_at is null')
    expect(p).toContain('edited_at is null')
    expect(p).toContain('public.is_member(c.server_id)')
  })
  it('messages için UPDATE/DELETE politikası yok (yalnız RPC)', () => {
    expect(sql6).not.toMatch(/create policy \w+ on public\.messages for (update|delete)/)
  })
  it('channels_delete politikası kaldırıldı', () => {
    expect(sql6).toContain('drop policy if exists channels_delete on public.channels')
    expect(sql6).not.toContain('create policy channels_delete')
  })
  const imzalar = {
    edit_message: '(bigint, text)', delete_message: '(bigint)', leave_server: '(uuid)', delete_server: '(uuid)',
    rename_server: '(uuid, text)', delete_channel: '(uuid)', rename_channel: '(uuid, text)',
    unread_counts: '()', mark_read: '(uuid, bigint)', can_access_server_topic: '(text)', can_access_text_topic: '(text)',
    sunucu_olayi_gonder: '()',
  }
  for (const [ad, imza] of Object.entries(imzalar)) {
    it(`${ad}: security definer, search_path, anon kapalı, authenticated açık`, () => {
      const f = fonk6(ad)
      expect(f).not.toBe('')
      expect(f).toContain('security definer')
      expect(f).toContain('set search_path = public')
      expect(sql6).toContain(`revoke all on function public.${ad}${imza} from public, anon`)
      expect(sql6).toContain(`grant execute on function public.${ad}${imza} to authenticated`)
    })
  }
  it('RPC parametre adları spec ile aynı', () => {
    for (const s of ['edit_message(id bigint, yeni text)', 'delete_message(id bigint)', 'leave_server(sid uuid)',
      'delete_server(sid uuid)', 'rename_server(sid uuid, ad text)', 'delete_channel(cid uuid)',
      'rename_channel(cid uuid, ad text)', 'unread_counts()', 'mark_read(cid uuid, mid bigint)']) {
      expect(sql6).toContain(`function public.${s}`)
    }
  })
  it('düzenleme yalnız yazar; silme yazar ya da sahip (yumuşak)', () => {
    expect(fonk6('edit_message')).toContain('m.author_id <> auth.uid()')
    const sil = fonk6('delete_message')
    expect(sil).toContain('m.author_id <> auth.uid()')
    expect(sil).toContain('s.owner_id = auth.uid()')
    expect(sil).toContain("set content = '', deleted_at = now()")
  })
  it('sahip ayrılamaz (spec metni); ayrılınca sesli durum ve okundu kayıtları silinir', () => {
    const f = fonk6('leave_server')
    expect(f).toContain('sahibi olduğun sunucudan ayrılamazsın; istersen sunucuyu silebilirsin.')
    expect(f).toContain('delete from public.voice_states')
    expect(f).toContain('delete from public.channel_reads')
  })
  it('delete_channel: sunucu satırı kilitlenir, sayım kilitten sonra; son yazılı kanal korunur', () => {
    const f = fonk6('delete_channel')
    const kilit = f.indexOf('for update')
    expect(f).toContain('from public.servers s where s.id = sid for update')
    expect(kilit).toBeGreaterThan(0)
    expect(f.indexOf("c.kind = 'text') <= 1")).toBeGreaterThan(kilit)
    expect(f).toContain('sunucuda en az bir yazılı kanal kalmalı.')
  })
  it('channel_reads: tablo, RLS, cascade, backfill', () => {
    expect(sql6).toContain('create table if not exists public.channel_reads')
    expect(sql6).toContain('user_id uuid not null references auth.users(id) on delete cascade')
    expect(sql6).toContain('channel_id uuid not null references public.channels(id) on delete cascade')
    expect(sql6).toContain('primary key (user_id, channel_id)')
    expect(sql6).toContain('alter table public.channel_reads enable row level security')
    expect(sql6).toMatch(/insert into public\.channel_reads \(user_id, channel_id, last_read_id\) select sm\.user_id, c\.id, coalesce\(\(select max\(m\.id\)/)
  })
  it('unread_counts: başkasının, silinmemiş mesajları, en fazla 100 (istemci 99+), taban id indeksli', () => {
    const f = fonk6('unread_counts')
    expect(f).toContain('m.deleted_at is null')
    expect(f).toContain('m.author_id <> auth.uid()')
    expect(f).toContain('limit 100')
    expect(f).toContain('m.id > t.taban')
    expect(f).toContain('sm.joined_at')
    expect(f).toContain("c.kind = 'text'")
  })
  it('mark_read yalnız ileri gider, üyelik denetlenir', () => {
    expect(fonk6('mark_read')).toContain('greatest(r.last_read_id, excluded.last_read_id)')
    expect(fonk6('mark_read')).toContain('public.is_member(c.server_id)')
  })
  it('realtime: server: yalnız alma; typing: alma+gönderme, yalnız broadcast', () => {
    expect(sql6).toContain('create policy server_receive on realtime.messages for select to authenticated')
    expect(sql6).not.toMatch(/create policy server_\w+ on realtime\.messages for insert/)
    expect(sql6).toContain('create policy typing_receive on realtime.messages for select to authenticated')
    expect(sql6).toContain('create policy typing_send on realtime.messages for insert to authenticated')
    const t = sql6.slice(sql6.indexOf('create policy typing_receive'))
    expect(t).toContain("realtime.messages.extension = 'broadcast'")
    expect(t).toContain('public.can_access_text_topic(realtime.topic())')
    expect(fonk6('can_access_text_topic')).toContain("c.kind = 'text'")
  })
  it('tetikleyiciler: silmede BEFORE, ekleme/güncellemede AFTER; realtime.send hatası yutulur', () => {
    expect(sql6).toContain('before delete on public.servers')
    expect(sql6).toContain('after update on public.servers')
    expect(sql6).toContain('after insert or update on public.channels')
    expect(sql6).toContain('before delete on public.channels')
    expect(sql6).toContain('before delete on public.server_members')
    const f = fonk6('sunucu_olayi_gonder')
    expect(f).toContain('perform realtime.send(')
    expect(f).toContain("'degisti', 'server:' || sid::text, true")
    expect(f).toContain('exception when others then')
  })
})
