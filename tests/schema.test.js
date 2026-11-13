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

// 007: sosyal (arkadaşlık, engel, DM, sessize alma, @bahsetme sayımı)
const yol7 = 'supabase/migrations/007_sosyal.sql'
const sql7 = existsSync(yol7) ? readFileSync(yol7, 'utf8').toLowerCase().replace(/\s+/g, ' ') : ''
const fonk7 = (ad) => {
  const i = sql7.search(new RegExp(`create (or replace )?function public\\.${ad}\\(`))
  if (i < 0) return ''
  const govdeBasi = sql7.indexOf('$$', i)
  return sql7.slice(i, sql7.indexOf('$$;', govdeBasi + 2) + 3)
}
describe('007_sosyal.sql', () => {
  it('dosya var', () => expect(existsSync(yol7)).toBe(true))
  it('tablolar ve RLS', () => {
    for (const t of ['friendships', 'blocks', 'dm_threads', 'dm_hidden', 'dm_messages', 'dm_reads', 'server_mutes']) {
      expect(sql7).toContain(`create table if not exists public.${t} (`)
      expect(sql7).toContain(`alter table public.${t} enable row level security`)
    }
  })
  it('friendships: sıralı çift, tek satır, durum kısıtı; yalnız iki taraf okur, yazma politikası yok', () => {
    expect(sql7).toContain('primary key (user_a, user_b)')
    expect(sql7).toContain('check (user_a < user_b)')
    expect(sql7).toContain("check (status in ('pending','accepted'))")
    expect(sql7).toContain('create policy friendships_select on public.friendships for select to authenticated using (user_a = auth.uid() or user_b = auth.uid())')
    expect(sql7).not.toMatch(/create policy \w+ on public\.friendships for (insert|update|delete)/)
  })
  it('blocks: yalnız engelleyen okur; engel_var istemciye kapalı', () => {
    expect(sql7).toContain('create policy blocks_select on public.blocks for select to authenticated using (blocker = auth.uid())')
    expect(sql7).not.toMatch(/create policy \w+ on public\.blocks for (insert|update|delete)/)
    expect(sql7).toContain('revoke all on function public.engel_var(uuid, uuid) from public, anon, authenticated')
    expect(sql7).not.toContain('grant execute on function public.engel_var')
  })
  it('dm_threads: benzersiz çift; dm_messages: içerik kuralı, indeks, yayın', () => {
    expect(sql7).toContain('constraint dm_threads_cift unique (user_a, user_b)')
    expect(sql7).toContain("(deleted_at is null and length(content) between 1 and 2000) or (deleted_at is not null and content = '')")
    expect(sql7).toContain('create index if not exists dm_messages_thread_idx on public.dm_messages (thread_id, id desc)')
    expect(sql7).toContain('alter publication supabase_realtime add table public.dm_messages')
  })
  it('dm_messages: iki taraf okur; ekleme yazar + engelsiz; UPDATE/DELETE politikası yok', () => {
    expect(sql7).toContain('create policy dm_messages_select on public.dm_messages for select to authenticated using (public.is_dm_participant(thread_id))')
    const p = sql7.slice(sql7.indexOf('create policy dm_messages_insert'))
    expect(p).toContain('author_id = auth.uid()')
    expect(p).toContain('deleted_at is null')
    expect(p).toContain('edited_at is null')
    expect(p).toContain('public.can_send_dm(thread_id)')
    expect(sql7).not.toMatch(/create policy \w+ on public\.dm_messages for (update|delete)/)
    expect(fonk7('can_send_dm')).toContain('not public.engel_var(t.user_a, t.user_b)')
  })
  it('server_mutes: yalnız kendi satırları, ekleme üyelik ister', () => {
    expect(sql7).toContain('user_id uuid not null default auth.uid()')
    expect(sql7).toContain('create policy server_mutes_select on public.server_mutes for select to authenticated using (user_id = auth.uid())')
    expect(sql7).toContain('with check (user_id = auth.uid() and public.is_member(server_id))')
    expect(sql7).toContain('create policy server_mutes_delete on public.server_mutes for delete to authenticated using (user_id = auth.uid())')
  })

  const imzalar7 = {
    send_friend_request: '(text)', accept_friend_request: '(uuid)', decline_friend_request: '(uuid)',
    remove_friend: '(uuid)', block_user: '(uuid)', unblock_user: '(uuid)', open_dm: '(uuid)',
    edit_dm_message: '(bigint, text)', delete_dm_message: '(bigint)', dm_list: '()', mark_dm_read: '(uuid, bigint)',
    hide_dm: '(uuid)', unread_counts: '()', mentions_user: '(text, text)', is_dm_participant: '(uuid)',
    can_send_dm: '(uuid)', can_access_dm_topic: '(text, boolean)', kisi_olayi_gonder: '()', dm_son_mesaj_guncelle: '()',
  }
  for (const [ad, imza] of Object.entries(imzalar7)) {
    it(`${ad}: security definer, search_path, anon kapalı, authenticated açık`, () => {
      const f = fonk7(ad)
      expect(f).not.toBe('')
      expect(f).toContain('security definer')
      expect(f).toContain('set search_path = public')
      expect(sql7).toContain(`revoke all on function public.${ad}${imza} from public, anon`)
      expect(sql7).toContain(`grant execute on function public.${ad}${imza} to authenticated`)
    })
  }
  it('RPC parametre adları (istemci bu adlarla çağırır)', () => {
    for (const s of ['send_friend_request(username text)', 'accept_friend_request(other uuid)',
      'decline_friend_request(other uuid)', 'remove_friend(other uuid)', 'block_user(other uuid)',
      'unblock_user(other uuid)', 'open_dm(other uuid)', 'edit_dm_message(id bigint, yeni text)',
      'delete_dm_message(id bigint)', 'dm_list()', 'mark_dm_read(tid uuid, mid bigint)', 'hide_dm(tid uuid)']) {
      expect(sql7).toContain(`function public.${s}`)
    }
  })
  it('hata kodları sabit', () => {
    for (const k of ['no_user', 'already_friends', 'already_sent', 'self', 'too_many', 'blocked_dm', 'not_allowed']) {
      expect(sql7).toContain(`raise exception '${k}'`)
    }
  })
  it('send_friend_request: engelde NO_USER, sınır 20, eşleşme, çift kilidi', () => {
    const f = fonk7('send_friend_request')
    expect(f).toMatch(/if public\.engel_var\(ben, diger\) then raise exception 'no_user'/)
    expect(f).toContain("= 'pending') >= 20 then raise exception 'too_many'")
    expect(f).toContain("set status = 'accepted', accepted_at = now()")
    expect(f).toContain("return 'accepted'")
    expect(f).toContain("return 'sent'")
    expect(f).toContain('pg_advisory_xact_lock(')
    // kilitten SONRA engel yeniden denetlenir (block_user ile yarış)
    const kilit = f.indexOf('pg_advisory_xact_lock(')
    expect(f.indexOf("if public.engel_var(ben, diger) then raise exception 'no_user'", kilit)).toBeGreaterThan(kilit)
  })
  it('block_user ve accept_friend_request aynı çift kilidini alır; kabulde engel denetlenir', () => {
    const kilit = "pg_advisory_xact_lock(hashtextextended( 'friendship:' || least(ben, other)::text || ':' || greatest(ben, other)::text, 0))"
    const blok = fonk7('block_user')
    expect(blok).toContain(kilit)
    expect(blok.indexOf(kilit)).toBeLessThan(blok.indexOf('delete from public.friendships'))
    expect(blok).toContain('delete from public.friendships')
    const kabul = fonk7('accept_friend_request')
    expect(kabul).toContain(kilit)
    expect(kabul).toMatch(/if public\.engel_var\(ben, other\) then raise exception 'not_allowed'/)
    expect(kabul.indexOf('engel_var')).toBeLessThan(kabul.indexOf('update public.friendships'))
    expect(fonk7('send_friend_request')).toContain("hashtextextended('friendship:' || a::text || ':' || b::text, 0)")
  })
  it('open_dm: arkadaşlık ya da ortak sunucu; engel; on conflict; gizlemeyi kaldırır', () => {
    const f = fonk7('open_dm')
    expect(f).toContain("fr.status = 'accepted'")
    expect(f).toContain('public.server_members s1 join public.server_members s2')
    expect(f).toContain('public.engel_var(ben, other)')
    expect(f).toContain('on conflict (user_a, user_b) do nothing')
    expect(f).toContain('delete from public.dm_hidden')
    // engel iki yolda da (var olan konuşma dahil) konuşma aranmadan ve gizleme silinmeden önce
    const aranan = f.indexOf('select t.id into tid')
    expect(f.indexOf("raise exception 'blocked_dm'")).toBeLessThan(aranan)
    expect(f.indexOf('public.engel_var(ben, other)')).toBeLessThan(aranan)
    expect(f.indexOf('public.engel_var(ben, other)')).toBeLessThan(f.indexOf('delete from public.dm_hidden'))
  })
  it('edit/delete_dm_message: yalnız yazar, yumuşak silme', () => {
    expect(fonk7('edit_dm_message')).toContain('m.author_id <> auth.uid()')
    const sil = fonk7('delete_dm_message')
    expect(sil).toContain('m.author_id <> auth.uid()')
    expect(sil).toContain("set content = '', deleted_at = now()")
  })
  it('mark_dm_read yalnız ileri; dm_list gizlenenleri süzer, okunmamış en fazla 100', () => {
    expect(fonk7('mark_dm_read')).toContain('greatest(r.last_read_id, excluded.last_read_id)')
    const l = fonk7('dm_list')
    expect(l).toContain('m2.id > h.hidden_after_id')
    expect(l).toContain('limit 100')
    expect(l).toContain('m.author_id <> auth.uid()')
  })
  it('unread_counts: drop + create; v0.3.0 sütunları aynı sırada, sona mentions', () => {
    expect(sql7).toContain('drop function if exists public.unread_counts();')
    expect(sql7).toContain('returns table (channel_id uuid, server_id uuid, count int, mentions int)')
    const f = fonk7('unread_counts')
    expect(f).toContain('public.mentions_user(y.content, ben.username)')
  })
  it('unread_counts.mentions: kanal başına en yeni 100 okunmamış taranır, "@" ön süzgeci', () => {
    const f = fonk7('unread_counts')
    const m = f.slice(f.indexOf('select m.content from public.messages m'))
    expect(m).toMatch(/m\.author_id <> auth\.uid\(\)\s+order by m\.id desc\s+limit 100\s+\) y/)
    expect(m).toMatch(/where y\.content like '%@%'\s+and public\.mentions_user\(y\.content, ben\.username\)/)
    // count sütunu 006'daki gibi kalır (sıralama yok, en fazla 100)
    expect(f.slice(0, f.indexOf('select m.content'))).toContain('limit 100')
  })
  it('mentions_user immutable (tabloya dokunmaz)', () => {
    const f = fonk7('mentions_user')
    expect(f).toMatch(/language sql\s+immutable/)
    expect(f).not.toContain('from public.')
  })
  it('bahsetme kuralı: büyük-küçük harf duyarsız, kelime sınırı, ad kaçırılır', () => {
    const f = fonk7('mentions_user')
    expect(f).toContain('~*')
    expect(f).toContain("'(^|[^[:alnum:]_])@'")
    expect(f).toContain("'($|[^[:alnum:]_])'")
    expect(f).toContain(String.raw`regexp_replace(ad, '([^[:alnum:]])', '\\\1', 'g')`)
  })
  it('realtime: user: yalnız kendisi alır (gönderme yok); dm-typing: iki taraf, yalnız broadcast', () => {
    const u = sql7.slice(sql7.indexOf('create policy user_receive'))
    expect(u).toContain('for select to authenticated')
    expect(u).toContain("realtime.topic() = 'user:' || auth.uid()::text")
    expect(sql7).not.toMatch(/create policy user_\w+ on realtime\.messages for insert/)
    expect(sql7).toContain('create policy dm_typing_receive on realtime.messages for select to authenticated')
    expect(sql7).toContain('create policy dm_typing_send on realtime.messages for insert to authenticated')
    const t = sql7.slice(sql7.indexOf('create policy dm_typing_receive'))
    expect(t).toContain("realtime.messages.extension = 'broadcast'")
    expect(fonk7('can_access_dm_topic')).toContain("'^dm-typing:[0-9a-f]{8}-")
  })
  it('tetikleyiciler: friendships/dm_threads iki tarafa degisti; last_message_at; hatalar yutulur', () => {
    expect(sql7).toContain('after insert or update or delete on public.friendships')
    expect(sql7).toContain('after insert or delete on public.dm_threads')
    expect(sql7).toContain('after insert on public.dm_messages')
    const f = fonk7('kisi_olayi_gonder')
    expect(f).toContain('perform realtime.send(')
    expect(f).toContain("'degisti', 'user:' || kisi::text, true")
    expect(f).toContain('exception when others then')
    const s = fonk7('dm_son_mesaj_guncelle')
    expect(s).toContain('set last_message_at = now()')
    expect(s).not.toContain('new.created_at')
    expect(s).toContain('exception when others then')
  })
  it('messages tablosuna dokunulmaz', () => {
    expect(sql7).not.toMatch(/alter table public\.messages|on public\.messages /)
  })
})

// 008: DM'den sesli arama (dm_calls, dm_messages.kind, arama RPC'leri, dm-voice: konusu)
const yol8 = 'supabase/migrations/008_dm_arama.sql'
const sql8 = existsSync(yol8) ? readFileSync(yol8, 'utf8').toLowerCase().replace(/\s+/g, ' ') : ''
const fonk8 = (ad) => {
  const i = sql8.search(new RegExp(`create (or replace )?function public\\.${ad}\\(`))
  if (i < 0) return ''
  const govdeBasi = sql8.indexOf('$$', i)
  return sql8.slice(i, sql8.indexOf('$$;', govdeBasi + 2) + 3)
}
describe('008_dm_arama.sql', () => {
  it('dosya var', () => expect(existsSync(yol8)).toBe(true))
  it('dm_calls: sütunlar, durum kısıtı, kısmi benzersiz indeks, RLS yalnız iki taraf okur, yazma politikası yok', () => {
    expect(sql8).toContain('create table if not exists public.dm_calls (')
    for (const s of ['id uuid primary key', 'thread_id uuid not null references public.dm_threads(id) on delete cascade',
      'caller uuid not null', 'callee uuid not null', "status text not null default 'ringing' check (status in ('ringing','active','ended'))",
      'created_at timestamptz', 'answered_at timestamptz', 'ended_at timestamptz', 'last_seen_at timestamptz']) {
      expect(sql8).toContain(s)
    }
    expect(sql8).toContain("create unique index if not exists dm_calls_acik_tek on public.dm_calls (thread_id) where status <> 'ended'")
    expect(sql8).toContain('alter table public.dm_calls enable row level security')
    expect(sql8).toContain('create policy dm_calls_select on public.dm_calls for select to authenticated using (caller = auth.uid() or callee = auth.uid())')
    expect(sql8).not.toMatch(/create policy \w+ on public\.dm_calls for (insert|update|delete|all)/)
  })
  it("dm_messages.kind: varsayılan 'text', kısıt; doğrudan INSERT yalnız 'text', diğer şartlar 007 ile aynı", () => {
    expect(sql8).toContain("add column if not exists kind text not null default 'text' check (kind in ('text','call'))")
    expect(sql8).toContain('drop policy if exists dm_messages_insert on public.dm_messages')
    const p = sql8.slice(sql8.indexOf('create policy dm_messages_insert'), sql8.indexOf('create or replace function public.edit_dm_message'))
    expect(p).toContain("for insert to authenticated with check ( author_id = auth.uid() and deleted_at is null and edited_at is null and kind = 'text' and public.can_send_dm(thread_id) )")
    expect(sql8).not.toMatch(/create policy \w+ on public\.dm_messages for (update|delete)/)
  })
  it("edit/delete_dm_message 'call' satırını reddeder; 007 davranışı korunur", () => {
    for (const ad of ['edit_dm_message', 'delete_dm_message']) {
      const f = fonk8(ad)
      expect(f).toContain("or m.kind = 'call'")
      expect(f).toContain('m.author_id <> auth.uid()')
      expect(f).toContain('for update')
    }
    expect(fonk8('edit_dm_message')).toContain('returns public.dm_messages')
    expect(fonk8('edit_dm_message')).toContain("raise exception 'blocked_dm'")
    expect(fonk8('delete_dm_message')).toContain("set content = '', deleted_at = now()")
  })
  it('dm_list ve unread_counts değişmez; messages tablosuna dokunulmaz', () => {
    expect(sql8).not.toContain('function public.dm_list')
    expect(sql8).not.toContain('function public.unread_counts')
    expect(sql8).not.toMatch(/alter table public\.messages|on public\.messages /)
  })

  const imzalar8 = {
    start_dm_call: '(uuid)', answer_dm_call: '(uuid)', end_dm_call: '(uuid, text)', ping_dm_call: '(uuid)',
    edit_dm_message: '(bigint, text)', delete_dm_message: '(bigint)', can_access_dm_voice_topic: '(text)',
    arama_olayi_gonder: '()',
  }
  for (const [ad, imza] of Object.entries(imzalar8)) {
    it(`${ad}: security definer, search_path, anon kapalı, authenticated açık`, () => {
      const f = fonk8(ad)
      expect(f).not.toBe('')
      expect(f).toContain('security definer')
      expect(f).toContain('set search_path = public')
      expect(sql8).toContain(`revoke all on function public.${ad}${imza} from public, anon`)
      expect(sql8).toContain(`grant execute on function public.${ad}${imza} to authenticated`)
    })
  }
  it('arama_kapat istemciye kapalı (yalnız veritabanı içinden)', () => {
    const f = fonk8('arama_kapat')
    expect(f).toContain('security definer')
    expect(f).toContain('set search_path = public')
    expect(sql8).toContain('revoke all on function public.arama_kapat(uuid, text) from public, anon, authenticated')
    expect(sql8).not.toContain('grant execute on function public.arama_kapat')
  })
  it('RPC parametre adları (istemci bu adlarla çağırır)', () => {
    for (const s of ['start_dm_call(tid uuid)', 'answer_dm_call(id uuid)', 'end_dm_call(id uuid, reason text)', 'ping_dm_call(id uuid)']) {
      expect(sql8).toContain(`function public.${s}`)
    }
  })
  it('start_dm_call: taraf, engelde gizli kodlar, kişi kilidi, bayatlar önce, ters yönden çalan kabul, BUSY', () => {
    const f = fonk8('start_dm_call')
    expect(f).toContain("raise exception 'not_allowed'")
    expect(f).toContain('bl.blocker = ben and bl.blocked = diger')
    expect(f).toContain("raise exception 'blocked_dm'")
    expect(f).toContain('public.can_send_dm(konusma.id)')
    expect(f).toContain("pg_advisory_xact_lock(hashtextextended('dmcall:' || konusma.user_a::text, 0))")
    expect(f).toContain("pg_advisory_xact_lock(hashtextextended('dmcall:' || konusma.user_b::text, 0))")
    // sıra: engel -> kilit -> bayat temizliği -> aynı konuşma -> meşgul -> ekleme
    const sira = ["raise exception 'blocked_dm'", 'pg_advisory_xact_lock(', "interval '60 seconds'",
      "perform public.arama_kapat(eski, 'lost')", "arama.status = 'ringing' and arama.caller = diger",
      "raise exception 'busy'", 'insert into public.dm_calls']
    for (let i = 1; i < sira.length; i++) expect(f.indexOf(sira[i - 1])).toBeLessThan(f.indexOf(sira[i]))
    expect(f).toContain("set status = 'active', answered_at = now()")
    expect(f).toContain('returns public.dm_calls')
  })
  it('start_dm_call: aramızda süren arama ALREADY_IN_CALL (birleştirilmez); yalnız karşıdan çalan arama kabul edilir', () => {
    const f = fonk8('start_dm_call')
    expect(f).toContain("if arama.status = 'active' then raise exception 'already_in_call'")
    // ALREADY_IN_CALL denetimi birleştirmeden önce, BUSY'den önce
    expect(f.indexOf("raise exception 'already_in_call'")).toBeLessThan(f.indexOf("arama.status = 'ringing' and arama.caller = diger"))
    expect(f.indexOf("raise exception 'already_in_call'")).toBeLessThan(f.indexOf("raise exception 'busy'"))
    // Birleştirme yalnız ringing + caller = diger dalında
    const dal = f.slice(f.indexOf("arama.status = 'ringing' and arama.caller = diger"))
    expect(dal.indexOf("set status = 'active'")).toBeLessThan(dal.indexOf('end if'))
  })
  it("start_dm_call: 40 sn'den uzun çalan arama da bayat (temizlikte); aktifte 60 sn kuralı aynen", () => {
    const f = fonk8('start_dm_call')
    expect(f).toContain("and (dc.last_seen_at < now() - interval '60 seconds' or (dc.status = 'ringing' and dc.created_at < now() - interval '40 seconds'))")
    // Temizlik birleştirme ve BUSY denetimlerinden önce (onlar yalnız bayat olmayanları görür)
    expect(f.indexOf("interval '40 seconds'")).toBeLessThan(f.indexOf("perform public.arama_kapat(eski, 'lost')"))
    expect(f.indexOf("perform public.arama_kapat(eski, 'lost')")).toBeLessThan(f.indexOf("raise exception 'already_in_call'"))
    // Kilit sırası değişmedi: user_a önce, user_b sonra, ikisi de temizlikten önce
    expect(f.indexOf("'dmcall:' || konusma.user_a")).toBeLessThan(f.indexOf("'dmcall:' || konusma.user_b"))
    expect(f.indexOf("'dmcall:' || konusma.user_b")).toBeLessThan(f.indexOf("interval '40 seconds'"))
    // Diğer fonksiyonlarda 40 sn kuralı yok (aktif aramada yalnız last_seen_at)
    for (const ad of ['answer_dm_call', 'ping_dm_call', 'can_access_dm_voice_topic']) expect(fonk8(ad)).not.toContain("interval '40 seconds'")
  })
  it('answer_dm_call: yalnız aranan, ringing -> active, engel denetimi, satır kilidi', () => {
    const f = fonk8('answer_dm_call')
    expect(f).toContain('arama.callee <> ben')
    expect(f).toContain('for update')
    expect(f).toContain("raise exception 'blocked_dm'")
    expect(f).toContain("set status = 'active', answered_at = now(), last_seen_at = now()")
  })
  it('end_dm_call: nedenler, iki taraf, arama_kapat ile tek kez kayıt satırı', () => {
    const f = fonk8('end_dm_call')
    expect(f).toContain("reason not in ('cancel','decline','timeout','hangup','lost')")
    expect(f).toContain('arama.caller <> ben and arama.callee <> ben')
    expect(f).toContain('perform public.arama_kapat(arama.id, reason)')
    // Cevaplanmış arama YALNIZ timeout ile bitmez (kaçan "active" olayı yarışı); cancel onu da bitirir.
    // Denetim kapanıştan önce, kilitli.
    expect(f).toContain("dc.id = end_dm_call.id for update")
    expect(f).toContain("if arama.status = 'active' and reason = 'timeout' then return")
    expect(f).not.toContain("reason in ('timeout','cancel')")
    expect(f.indexOf("reason = 'timeout' then return")).toBeLessThan(f.indexOf('perform public.arama_kapat'))
    const k = fonk8('arama_kapat')
    expect(k).toContain('for update')
    expect(k).toContain("arama.status = 'ended' then return")
    expect(k.indexOf("arama.status = 'ended' then return")).toBeLessThan(k.indexOf('insert into public.dm_messages'))
    expect(k).toContain("'📞 cevapsız arama'")
    expect(k).toContain("'📞 arama · '")
    expect(k).toContain("values (arama.thread_id, arama.caller, metin, 'call')")
  })
  it('ping_dm_call: yalnız taraf, bitmemiş ve bayat olmayan aramada last_seen_at', () => {
    const f = fonk8('ping_dm_call')
    expect(f).toContain('set last_seen_at = now()')
    expect(f).toContain("dc.status <> 'ended'")
    expect(f).toContain("dc.last_seen_at >= now() - interval '60 seconds'")
    expect(f).toContain('returns boolean')
  })
  it('tetikleyici: iki tarafın user: konusuna "arama"; yük alanları; ping olay üretmez; hata yutulur', () => {
    expect(sql8).toContain('after insert or update on public.dm_calls')
    const f = fonk8('arama_olayi_gonder')
    for (const a of ["'call_id', new.id", "'thread_id', new.thread_id", "'status', new.status", "'caller', new.caller"]) {
      expect(f).toContain(a)
    }
    expect(f).toContain("'arama', 'user:' || kisi::text, true")
    expect(f).toContain('old.status is not distinct from new.status then return null')
    expect(f).toContain('exception when others then')
  })
  it('dm-voice: konusu yalnız iki taraf, bitmemiş arama; yalnız broadcast ve presence', () => {
    const f = fonk8('can_access_dm_voice_topic')
    expect(f).toContain("'^dm-voice:[0-9a-f]{8}-")
    expect(f).toContain('dc.caller = auth.uid() or dc.callee = auth.uid()')
    expect(f).toContain("dc.status <> 'ended'")
    expect(sql8).toContain('create policy dm_voice_receive on realtime.messages for select to authenticated')
    expect(sql8).toContain('create policy dm_voice_send on realtime.messages for insert to authenticated')
    for (const ad of ['dm_voice_receive', 'dm_voice_send']) {
      const p = sql8.slice(sql8.indexOf(`create policy ${ad}`))
      expect(p).toContain("realtime.messages.extension in ('broadcast', 'presence')")
      expect(p).toContain('public.can_access_dm_voice_topic(realtime.topic())')
    }
  })
})
