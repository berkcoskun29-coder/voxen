// Çevrimdışı şema testi (tests/schema.test.js kalıbı): 009 emoji tepkileri, yanıtlama, sabitleme (v0.7.0)
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { EMOJILER } from '../src/data/reactions.js'

const yol9 = 'supabase/migrations/009_tepki_yanit_sabit.sql'
const ham9 = existsSync(yol9) ? readFileSync(yol9, 'utf8') : ''
const sql9 = ham9.toLowerCase().replace(/\s+/g, ' ')
const fonk9 = (ad) => {
  const i = sql9.search(new RegExp(`create (or replace )?function public\\.${ad}\\(`))
  if (i < 0) return ''
  const govdeBasi = sql9.indexOf('$$', i)
  return sql9.slice(i, sql9.indexOf('$$;', govdeBasi + 2) + 3)
}
const politika9 = (ad) => {
  const i = sql9.indexOf(`create policy ${ad} `)
  if (i < 0) return ''
  return sql9.slice(i, sql9.indexOf(';', i) + 1)
}

describe('009_tepki_yanit_sabit.sql', () => {
  it('dosya var', () => expect(existsSync(yol9)).toBe(true))

  it('reply_to: iki tabloya nullable, on delete set null, kısmi indeks', () => {
    expect(sql9).toContain('alter table public.messages add column if not exists reply_to bigint references public.messages(id) on delete set null')
    expect(sql9).toContain('alter table public.dm_messages add column if not exists reply_to bigint references public.dm_messages(id) on delete set null')
    expect(sql9).toContain('on public.messages (reply_to) where reply_to is not null')
    expect(sql9).toContain('on public.dm_messages (reply_to) where reply_to is not null')
    // yalnız nullable sütun: not null ya da sütun silme/yeniden adlandırma yok
    expect(sql9).not.toMatch(/reply_to bigint not null/)
    expect(sql9).not.toMatch(/drop column|rename column|rename to/)
  })

  it('messages_insert: eski şartlar aynen + reply_ok; dm_messages_insert: 008 şartları + dm_reply_ok', () => {
    const p = politika9('messages_insert')
    expect(p).toContain('for insert to authenticated with check ( author_id = auth.uid() and deleted_at is null and edited_at is null and exists (select 1 from public.channels c where c.id = channel_id and public.is_member(c.server_id)) and public.reply_ok(reply_to, channel_id) )')
    const d = politika9('dm_messages_insert')
    expect(d).toContain("for insert to authenticated with check ( author_id = auth.uid() and deleted_at is null and edited_at is null and kind = 'text' and public.can_send_dm(thread_id) and public.dm_reply_ok(reply_to, thread_id) )")
    expect(sql9).toContain('drop policy if exists messages_insert on public.messages')
    expect(sql9).toContain('drop policy if exists dm_messages_insert on public.dm_messages')
  })

  it("reply_ok / dm_reply_ok: null serbest; aynı kanal/DM, silinmemiş; DM'de yalnız text", () => {
    const r = fonk9('reply_ok')
    expect(r).toContain('rid is null or exists')
    expect(r).toContain('m.channel_id = cid')
    expect(r).toContain('m.deleted_at is null')
    const d = fonk9('dm_reply_ok')
    expect(d).toContain('rid is null or exists')
    expect(d).toContain('m.thread_id = tid')
    expect(d).toContain('m.deleted_at is null')
    expect(d).toContain("m.kind = 'text'")
  })

  it("dm_messages.kind kısıtı ('text','call','pin'); eski kısıt tanımına bakılarak kaldırılır", () => {
    expect(sql9).toContain("check (kind in ('text','call','pin'))")
    expect(sql9).toContain("pg_get_constraintdef(oid) ilike '%kind%'")
    expect(sql9).toContain('drop constraint if exists dm_messages_kind_check')
  })

  it('8 emoji, tek kaynak tepki_gecerli (immutable); tablolarda kısıt; istemci listesiyle aynı', () => {
    const f = fonk9('tepki_gecerli')
    expect(f).toContain('immutable')
    expect(EMOJILER).toEqual(['👍', '👎', '😂', '❤️', '😮', '😢', '🔥', '🎉'])
    // Aynı kod noktaları (❤️ = U+2764 U+FE0F): istemcinin gönderdiğini sunucu kabul etmeli
    const liste = ham9.slice(ham9.indexOf('function public.tepki_gecerli'))
    const icerik = liste.slice(liste.indexOf('in ('), liste.indexOf(')', liste.indexOf('in (')))
    const sunucu = [...icerik.matchAll(/'([^']+)'/g)].map((x) => x[1])
    expect(sunucu).toEqual(EMOJILER)
    expect(sql9.match(/emoji text not null check \(public\.tepki_gecerli\(emoji\)\)/g)?.length).toBe(2)
  })

  it('tepki tabloları: cascade, kişi başı emoji bir kez, RLS yalnız okuma', () => {
    expect(sql9).toContain('create table if not exists public.message_reactions (')
    expect(sql9).toContain('message_id bigint not null references public.messages(id) on delete cascade')
    expect(sql9).toContain('create table if not exists public.dm_message_reactions (')
    expect(sql9).toContain('message_id bigint not null references public.dm_messages(id) on delete cascade')
    expect(sql9.match(/primary key \(message_id, user_id, emoji\)/g)?.length).toBe(2)
    for (const t of ['message_reactions', 'dm_message_reactions', 'message_pins', 'dm_message_pins']) {
      expect(sql9).toContain(`alter table public.${t} enable row level security`)
      expect(sql9).not.toMatch(new RegExp(`create policy \\w+ on public\\.${t} for (insert|update|delete|all)`))
    }
    expect(politika9('message_reactions_select')).toContain('public.is_member(c.server_id)')
    expect(politika9('dm_message_reactions_select')).toContain('public.is_dm_participant(m.thread_id)')
  })

  it('sabit tabloları: mesaj başına tek satır, konuşma sütunu, cascade; RLS yalnız okuma', () => {
    expect(sql9).toContain('create table if not exists public.message_pins ( message_id bigint primary key references public.messages(id) on delete cascade')
    expect(sql9).toContain('channel_id uuid not null references public.channels(id) on delete cascade')
    expect(sql9).toContain('create table if not exists public.dm_message_pins ( message_id bigint primary key references public.dm_messages(id) on delete cascade')
    expect(sql9).toContain('thread_id uuid not null references public.dm_threads(id) on delete cascade')
    expect(sql9).toContain('on public.message_pins (channel_id, pinned_at desc)')
    expect(sql9).toContain('on public.dm_message_pins (thread_id, pinned_at desc)')
    expect(politika9('message_pins_select')).toContain('public.is_member(c.server_id)')
    expect(politika9('dm_message_pins_select')).toContain('public.is_dm_participant(thread_id)')
  })

  const imzalar9 = {
    reply_ok: '(bigint, uuid)', dm_reply_ok: '(bigint, uuid)', tepki_gecerli: '(text)',
    react_message: '(bigint, text, boolean)', react_dm_message: '(bigint, text, boolean)',
    can_pin: '(uuid)', pin_message: '(bigint, boolean)', pin_dm_message: '(bigint, boolean)',
    edit_dm_message: '(bigint, text)', delete_dm_message: '(bigint)',
    tepki_olayi_gonder: '()', sabit_olayi_gonder: '()', mesaj_silinince_temizle: '()',
  }
  for (const [ad, imza] of Object.entries(imzalar9)) {
    it(`${ad}: security definer, search_path, anon kapalı, authenticated açık`, () => {
      const f = fonk9(ad)
      expect(f).not.toBe('')
      expect(f).toContain('security definer')
      expect(f).toContain('set search_path = public')
      expect(sql9).toContain(`revoke all on function public.${ad}${imza} from public, anon`)
      expect(sql9).toContain(`grant execute on function public.${ad}${imza} to authenticated`)
    })
  }

  it('RPC parametre adları (istemci bu adlarla çağırır)', () => {
    const imzalar = [
      'react_message(mid bigint, tepki text, ekle boolean)',
      'react_dm_message(mid bigint, tepki text, ekle boolean)',
      'pin_message(mid bigint, sabitle boolean)',
      'pin_dm_message(mid bigint, sabitle boolean)',
      'can_pin(cid uuid)',
    ]
    for (const s of imzalar) expect(sql9).toContain(`function public.${s}`)
  })

  it('react_message: geçersiz emoji, üyelik, silinmiş mesaj NOT_ALLOWED; satır kilidi; tekrarlanabilir', () => {
    const f = fonk9('react_message')
    expect(f).toContain('not public.tepki_gecerli(tepki)')
    expect(f).toContain("raise exception 'not_allowed'")
    expect(f).toContain('for share')
    expect(f).toContain('m.deleted_at is not null')
    expect(f).toContain('public.is_member(c.server_id)')
    expect(f).toContain('on conflict (message_id, user_id, emoji) do nothing')
    expect(f).toContain('delete from public.message_reactions')
  })

  it('react_dm_message: yalnız text satırı, taraf; eklemede engel gizli kodlarla; kaldırma engelde serbest', () => {
    const f = fonk9('react_dm_message')
    expect(f).toContain("m.kind <> 'text'")
    expect(f).toContain('public.is_dm_participant(m.thread_id)')
    expect(f).toContain('for share')
    expect(f).toContain("raise exception 'blocked_dm'")
    expect(f).toContain('public.engel_var(t.user_a, t.user_b)')
    // engel denetimi yalnız ekleme dalında, insert'ten önce; kaldırma (else) engele bakmaz
    const ekle = f.slice(f.indexOf('if ekle then'))
    expect(ekle.indexOf("raise exception 'blocked_dm'")).toBeLessThan(ekle.indexOf('insert into public.dm_message_reactions'))
    const kaldir = ekle.slice(ekle.indexOf('else delete'))
    expect(kaldir).not.toContain('blocked_dm')
    expect(f).toContain('on conflict (message_id, user_id, emoji) do nothing')
  })

  it('can_pin: yetki tek yerde — kanalın sunucusunun sahibi', () => {
    const f = fonk9('can_pin')
    expect(f).toContain('s.owner_id = auth.uid()')
    expect(f).toContain('c.id = cid')
    expect(f).toContain('stable')
  })

  it('pin_message: can_pin ile yetki, kanal kilidi, 50 sınırı PIN_LIMIT, sistem satırı YOK', () => {
    const f = fonk9('pin_message')
    expect(f).toContain('public.can_pin(m.channel_id)')
    expect(f).toContain("pg_advisory_xact_lock(hashtextextended('pin:' || m.channel_id::text, 0))")
    expect(f).toContain(">= 50 then raise exception 'pin_limit'")
    expect(f.indexOf('pg_advisory_xact_lock')).toBeLessThan(f.indexOf("raise exception 'pin_limit'"))
    expect(f).toContain('insert into public.message_pins')
    expect(f).toContain('delete from public.message_pins')
    expect(f).not.toContain('insert into public.messages')
    // yetki denetimi başka yerde tekrarlanmaz (roller can_pin'e eklenecek)
    expect(f).not.toContain('owner_id')
  })

  it("pin_dm_message: taraf, engel gizli kodlar, kilit, 50 sınırı, 'pin' sistem satırı", () => {
    const f = fonk9('pin_dm_message')
    expect(f).toContain("m.kind <> 'text'")
    expect(f).toContain("raise exception 'blocked_dm'")
    expect(f).toContain('public.engel_var(t.user_a, t.user_b)')
    expect(f).toContain("pg_advisory_xact_lock(hashtextextended('dmpin:' || m.thread_id::text, 0))")
    expect(f).toContain(">= 50 then raise exception 'pin_limit'")
    expect(f).toContain('insert into public.dm_message_pins')
    expect(f).toContain("' bir mesajı sabitledi.'")
    expect(f).toContain("'pin')")
    // sistem satırı yalnız sabitlemede (kaldırmada değil) ve sabitten sonra
    expect(f.indexOf('insert into public.dm_message_pins')).toBeLessThan(f.indexOf('insert into public.dm_messages'))
  })

  it("edit/delete_dm_message: kind <> 'text' olan her satırı reddeder (call ve pin)", () => {
    for (const ad of ['edit_dm_message', 'delete_dm_message']) {
      const f = fonk9(ad)
      expect(f).toContain("or m.kind <> 'text'")
      expect(f).toContain('m.author_id <> auth.uid()')
      expect(f).toContain('for update')
    }
    expect(fonk9('edit_dm_message')).toContain('returns public.dm_messages')
    expect(fonk9('edit_dm_message')).toContain("raise exception 'blocked_dm'")
    expect(fonk9('delete_dm_message')).toContain("set content = '', deleted_at = now()")
  })

  it('tetikleyiciler: tepki ve sabit olayları server:/user: konularına; silinmiş mesajda olay yok; hata yutulur', () => {
    const t = fonk9('tepki_olayi_gonder')
    expect(t).toContain("'tepki', 'server:' || sid::text, true")
    expect(t).toContain("'tepki', 'user:' || kisi::text, true")
    for (const a of ["'message_id'", "'emoji'", "'user_id'", "'islem', tg_op", "'channel_id'", "'thread_id'"]) expect(t).toContain(a)
    expect(t).toContain('exception when others then')
    expect(t).toContain('where m.id = mid and m.deleted_at is null')
    expect(fonk9('sabit_olayi_gonder')).toContain('where m.id = mid and m.deleted_at is null')
    const s = fonk9('sabit_olayi_gonder')
    expect(s).toContain("'sabit', 'server:' || sid::text, true")
    expect(s).toContain("'sabit', 'user:' || kisi::text, true")
    expect(s).toContain('exception when others then')
    for (const t2 of ['message_reactions', 'dm_message_reactions', 'message_pins', 'dm_message_pins']) {
      expect(sql9).toContain(`after insert or delete on public.${t2}`)
    }
  })

  it('yumuşak silmede tepkiler ve sabit temizlenir', () => {
    const f = fonk9('mesaj_silinince_temizle')
    expect(f).toContain('delete from public.message_reactions')
    expect(f).toContain('delete from public.message_pins')
    expect(f).toContain('delete from public.dm_message_reactions')
    expect(f).toContain('delete from public.dm_message_pins')
    expect(sql9).toContain('after update of deleted_at on public.messages for each row when (old.deleted_at is null and new.deleted_at is not null)')
    expect(sql9).toContain('after update of deleted_at on public.dm_messages for each row when (old.deleted_at is null and new.deleted_at is not null)')
  })

  it('uyumluluk: dm_list, unread_counts, edit/delete_message değişmez; kanala sistem satırı yazılmaz', () => {
    for (const ad of ['dm_list', 'unread_counts', 'edit_message', 'delete_message', 'mark_read', 'mark_dm_read']) {
      expect(sql9).not.toContain(`function public.${ad}(`)
    }
    expect(sql9).not.toMatch(/insert into public\.messages/)
    expect(sql9).not.toMatch(/create policy \w+ on public\.(messages|dm_messages) for (update|delete)/)
  })
})
