// Çevrimdışı şema testi (tests/schema.test.js kalıbı): 011 grup DM ve çok kişili arama (v0.9.0)
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { GRUP_EN_AZ, GRUP_EN_FAZLA, GRUP_ADI_MAX } from '../src/data/groups.js'

const yol = 'supabase/migrations/011_grup_dm.sql'
const ham = existsSync(yol) ? readFileSync(yol, 'utf8') : ''
const sql = ham.toLowerCase().replace(/\s+/g, ' ')
const fonk = (ad) => {
  const i = sql.search(new RegExp(`create (or replace )?function public\\.${ad}\\(`))
  if (i < 0) return ''
  const govdeBasi = sql.indexOf('$$', i)
  return sql.slice(i, sql.indexOf('$$;', govdeBasi + 2) + 3)
}
const politika = (ad) => {
  const i = sql.indexOf(`create policy ${ad} `)
  if (i < 0) return ''
  return sql.slice(i, sql.indexOf(';', i) + 1)
}
// Fonksiyonun imzası: "public.ad(tip, tip)"
const imza = (ad, tipler) => `public.${ad}(${tipler})`

const ISTEMCI_RPC = [
  ['create_group_dm', 'uuid[], text'],
  ['add_group_member', 'uuid, uuid'],
  ['remove_group_member', 'uuid, uuid'],
  ['leave_group', 'uuid'],
  ['rename_group', 'uuid, text'],
  ['group_dm_list', ''],
  ['start_group_call', 'uuid'],
  ['join_group_call', 'uuid'],
  ['leave_group_call', 'uuid, text'],
  ['ping_group_call', 'uuid'],
]
const ICERIDE = [
  ['dm_kisileri', 'uuid'],
  ['dm_engel_denetle', 'uuid'],
  ['belirtme_eki', 'text'],
  ['kisi_adi', 'uuid'],
  ['grup_sayisi', 'uuid'],
  ['gruba_eklenebilir', 'uuid, uuid'],
  ['grup_sistem_satiri', 'uuid, uuid, text'],
  ['benim_grubum', 'uuid'],
  ['grup_adi', 'text'],
  ['gruptan_dusur', 'uuid, uuid'],
  ['kisi_ikili_aramada', 'uuid'],
  ['kisi_grup_aramasinda', 'uuid, uuid'],
  ['grup_arama_olayi', 'uuid'],
  ['arama_kapat', 'uuid, text'],
  ['grup_aramasi_temizle', 'uuid'],
  ['grup_aramasina_katil', 'uuid, uuid'],
]

describe('011_grup_dm.sql', () => {
  it('dosya var', () => expect(existsSync(yol)).toBe(true))

  it('sütun silme / yeniden adlandırma yok; dm_list ve unread_counts değişmez', () => {
    expect(sql).not.toMatch(/drop column|rename column|rename to/)
    expect(fonk('dm_list')).toBe('')
    expect(fonk('unread_counts')).toBe('')
    expect(fonk('open_dm')).toBe('')
  })

  it('dm_threads genelleşir: is_group, name (1–100), owner_id; grup satırında taraflar boş', () => {
    expect(sql).toContain('alter table public.dm_threads add column if not exists is_group boolean not null default false')
    expect(sql).toContain(`check (name is null or length(name) between 1 and ${GRUP_ADI_MAX})`)
    expect(sql).toContain('add column if not exists owner_id uuid references auth.users(id) on delete set null')
    expect(sql).toContain('alter table public.dm_threads alter column user_a drop not null')
    expect(sql).toContain('alter table public.dm_threads alter column user_b drop not null')
    expect(sql).toContain('(is_group and user_a is null and user_b is null) or (not is_group and user_a is not null and user_b is not null and name is null)')
  })

  it('yeni tablolarda RLS açık; yazma politikası yalnız dm_mutes (kendi satırı)', () => {
    for (const t of ['dm_members', 'dm_mutes', 'dm_call_members']) {
      expect(sql).toContain(`alter table public.${t} enable row level security`)
    }
    expect(politika('dm_members_select')).toContain('public.is_dm_participant(thread_id)')
    expect(sql).not.toMatch(/create policy \w+ on public\.(dm_members|dm_call_members) for (insert|update|delete|all)/)
    expect(politika('dm_mutes_insert')).toContain('user_id = auth.uid() and public.is_dm_participant(thread_id)')
    expect(politika('dm_mutes_delete')).toContain('using (user_id = auth.uid())')
    expect(politika('dm_mutes_select')).toContain('using (user_id = auth.uid())')
  })

  it("dm_messages.kind'a 'system' eklenir (eski türler kalır)", () => {
    expect(sql).toContain("add constraint dm_messages_kind_check check (kind in ('text','call','pin','system'))")
  })

  it('is_dm_participant ve can_send_dm üyeliğe göre genelleşir; bire bir kural aynı', () => {
    const p = fonk('is_dm_participant')
    expect(p).toContain('t.user_a = auth.uid() or t.user_b = auth.uid()')
    expect(p).toContain('from public.dm_members m where m.thread_id = tid and m.user_id = auth.uid()')
    const c = fonk('can_send_dm')
    expect(c).toContain('not t.is_group')
    expect(c).toContain('not public.engel_var(t.user_a, t.user_b)')
    expect(c).toContain('t.is_group')
  })

  it('engel kodları tek yerde: dm_engel_denetle (bire bir BLOCKED_DM / NOT_ALLOWED; grupta yok)', () => {
    const f = fonk('dm_engel_denetle')
    expect(f).toContain('if t.is_group then return')
    expect(f).toContain("raise exception 'blocked_dm'")
    expect(f).toContain("raise exception 'not_allowed'")
    for (const ad of ['edit_dm_message', 'react_dm_message', 'pin_dm_message', 'send_dm_with_attachments']) {
      const g = fonk(ad)
      expect(g, ad).toContain('perform public.dm_engel_denetle(')
      expect(g, ad).not.toContain('diger :=') // "diğer kişi" varsayımı kalmadı
    }
    // Düz mesaj dışı (call, pin, system) satırlar düzenlenmez, tepki/sabit almaz
    expect(fonk('edit_dm_message')).toContain("m.kind <> 'text'")
    expect(fonk('react_dm_message')).toContain("m.kind <> 'text'")
    expect(fonk('pin_dm_message')).toContain("m.kind <> 'text'")
  })

  it('tepki ve sabit olayları konuşmanın bütün kişilerine (dm_kisileri)', () => {
    for (const ad of ['tepki_olayi_gonder', 'sabit_olayi_gonder']) {
      const f = fonk(ad)
      expect(f).toContain('public.dm_kisileri(tid)')
      expect(f).not.toContain('array[a, b]')
    }
    expect(fonk('dm_kisileri')).toContain('when t.is_group then array( select m.user_id from public.dm_members m')
  })

  it('kisi_olayi_gonder boş kişiyi atlar; dm_members değişince eklenen/çıkana gider', () => {
    const f = fonk('kisi_olayi_gonder')
    expect(f).toContain('if kisi is null then continue')
    expect(f).toContain("tg_table_name = 'dm_members'")
    expect(sql).toContain('create trigger dm_members_degisti after insert or delete on public.dm_members')
  })

  it('her fonksiyon security definer + search_path; istemci RPC\'leri yalnız authenticated, içtekiler kimseye açık değil', () => {
    for (const [ad, tipler] of [...ISTEMCI_RPC, ...ICERIDE]) {
      const f = fonk(ad)
      expect(f, ad).not.toBe('')
      expect(f, ad).toContain('security definer')
      expect(f, ad).toContain('set search_path = public')
    }
    for (const [ad, tipler] of ISTEMCI_RPC) {
      expect(sql, ad).toContain(`revoke all on function ${imza(ad, tipler)} from public, anon;`)
      expect(sql, ad).toContain(`grant execute on function ${imza(ad, tipler)} to authenticated;`)
    }
    for (const [ad, tipler] of ICERIDE) {
      expect(sql, ad).toContain(`revoke all on function ${imza(ad, tipler)} from public, anon, authenticated;`)
      expect(sql, ad).not.toContain(`grant execute on function ${imza(ad, tipler)} to authenticated`)
    }
  })

  it('create_group_dm: 3–10 kişi, arkadaş + engelsiz (gizli kod CANNOT_ADD), 100 grup sınırı, sistem satırı', () => {
    const f = fonk('create_group_dm')
    expect(f).toContain(`cardinality(liste) + 1 < ${GRUP_EN_AZ}`)
    expect(f).toContain(`cardinality(liste) + 1 > ${GRUP_EN_FAZLA}`)
    expect(f).toContain("raise exception 'too_few'")
    expect(f).toContain("raise exception 'group_full'")
    expect(f).toContain("raise exception 'too_many'")
    expect(f).toContain("raise exception 'cannot_add'")
    expect(f).toContain('public.gruba_eklenebilir(ben, u)')
    expect(f).toContain("' grubu oluşturdu.'")
    const e = fonk('gruba_eklenebilir')
    expect(e).toContain("fr.status = 'accepted'")
    expect(e).toContain('not public.engel_var(ben, uid)')
  })

  it('add_group_member: grup kilidi, ALREADY_MEMBER, CANNOT_ADD, GROUP_FULL (10), okundu başlangıcı, sistem satırı', () => {
    const f = fonk('add_group_member')
    expect(f).toContain("pg_advisory_xact_lock(hashtextextended('dmgroup:' || tid::text, 0))")
    expect(f).toContain("raise exception 'already_member'")
    expect(f).toContain("raise exception 'cannot_add'")
    expect(f).toContain(`>= ${GRUP_EN_FAZLA} then raise exception 'group_full'`)
    expect(f).toContain('insert into public.dm_reads')
    expect(f).toContain("' ekledi.'")
    expect(f).toContain('public.belirtme_eki(')
  })

  it('leave_group: kuruculuk en eski üyeye, son üyede grup silinir; remove yalnız kurucu; rename her üye', () => {
    const l = fonk('leave_group')
    expect(l).toContain('order by m.joined_at, m.user_id limit 1')
    expect(l).toContain('delete from public.dm_threads th where th.id = tid')
    expect(l).toContain('update public.dm_threads th set owner_id = yeni')
    expect(l).toContain("' gruptan ayrıldı.'")
    const r = fonk('remove_group_member')
    expect(r).toContain('t.owner_id is distinct from ben')
    expect(r).toContain("' çıkardı.'")
    const n = fonk('rename_group')
    expect(n).toContain('public.benim_grubum(tid)')
    expect(n).toContain("' grubun adını kaldırdı.'")
  })

  it('sistem satırları kind system ile yazılır', () => {
    expect(fonk('grup_sistem_satiri')).toContain("'system'")
  })

  it('dm_calls genelleşir: is_group, callee boş olabilir, kısıt; dm_call_members', () => {
    expect(sql).toContain('alter table public.dm_calls add column if not exists is_group boolean not null default false')
    expect(sql).toContain('alter table public.dm_calls alter column callee drop not null')
    expect(sql).toContain('(is_group and callee is null) or (not is_group and callee is not null)')
    expect(sql).toContain('create table if not exists public.dm_call_members (')
    expect(sql).toContain('call_id uuid not null references public.dm_calls(id) on delete cascade')
    const p = politika('dm_calls_select')
    expect(p).toContain('caller = auth.uid() or callee = auth.uid()')
    expect(p).toContain('is_group and public.is_dm_participant(thread_id)')
  })

  it('bire bir arama RPC\'leri grup aramasını reddeder (callee boşken açık kapı kalmaz)', () => {
    expect(fonk('start_dm_call')).toContain('konusma.is_group')
    expect(fonk('answer_dm_call')).toContain('arama.is_group or arama.callee is null')
    expect(fonk('end_dm_call')).toContain('arama.is_group or arama.callee is null')
    expect(fonk('ping_dm_call')).toContain('and not dc.is_group')
    // Karşı taraf grup aramasındaysa BUSY
    expect(fonk('start_dm_call')).toContain('public.kisi_grup_aramasinda(diger, null)')
  })

  it('grup araması: kilitler, ALREADY_IN_CALL, CALL_FULL, 60 sn bayatlık, 40 sn çalma', () => {
    const s = fonk('start_group_call')
    expect(s).toContain("hashtextextended('grpcall:' || tid::text, 0)")
    expect(s).toContain("hashtextextended('dmcall:' || ben::text, 0)")
    expect(s).toContain("raise exception 'already_in_call'")
    const k = fonk('grup_aramasina_katil')
    expect(k).toContain("raise exception 'already_in_call'")
    expect(k).toContain("raise exception 'call_full'")
    const t = fonk('grup_aramasi_temizle')
    expect(t).toContain("cm.last_seen_at < now() - interval '60 seconds'")
    expect(t).toContain("arama.created_at < now() - interval '40 seconds'")
    const l = fonk('leave_group_call')
    expect(l).toContain("reason in ('cancel','timeout') and arama.status = 'ringing' and arama.caller = ben")
    expect(fonk('ping_group_call')).toContain("cm.last_seen_at >= now() - interval '60 seconds'")
  })

  it('kayıt satırı: "📞 Grup araması · mm:ss · N kişi" ya da cevapsız', () => {
    const f = fonk('arama_kapat')
    expect(f).toContain("'📞 grup araması · ' || sure_yazi || ' · ' || kisi::text || ' kişi'")
    expect(f).toContain("'📞 cevapsız grup araması'")
    // Bire bir metinler aynı
    expect(f).toContain("'📞 cevapsız arama'")
    expect(f).toContain("'📞 arama · ' || sure_yazi")
  })

  it('olay: grup araması ayrı adla ("grup_arama"); bire bir "arama" aynı', () => {
    expect(fonk('grup_arama_olayi')).toContain("'grup_arama'")
    expect(fonk('grup_arama_olayi')).toContain("'count', sayi")
    const a = fonk('arama_olayi_gonder')
    expect(a).toContain('if new.is_group then')
    expect(a).toContain("'arama'")
    expect(sql).toContain('create trigger dm_call_members_degisti after insert or update on public.dm_call_members')
  })

  it('dm-voice: politikası: grupta üye + aramada + arama bitmemiş', () => {
    const f = fonk('can_access_dm_voice_topic')
    expect(f).toContain('not dc.is_group')
    expect(f).toContain('cm.left_at is null')
    expect(f).toContain('public.is_dm_participant(dc.thread_id)')
    expect(f).toContain("dc.last_seen_at >= now() - interval '60 seconds'")
  })

  it('group_dm_list: üyeler, okunmamış, sessiz, süren arama ve sayısı', () => {
    const f = fonk('group_dm_list')
    for (const s of ['thread_id uuid', 'name text', 'owner_id uuid', 'members jsonb', 'unread int', 'muted boolean', 'call_id uuid', 'call_count int']) {
      expect(f).toContain(s)
    }
    expect(f).toContain('where ben.user_id = auth.uid()')
    expect(f).toContain('h.hidden_after_id')
  })

  // ---- Düzeltme turu 1 ----
  it('I1: gruptan düşürülenin arama satırı hemen biter; olay katılımcı listesini taşır', () => {
    const f = fonk('gruptan_dusur')
    const kilit = f.indexOf("hashtextextended('grpcall:' || tid::text, 0)")
    const satir = f.indexOf('update public.dm_call_members cm set left_at = now()')
    expect(kilit).toBeGreaterThan(0)
    expect(satir).toBeGreaterThan(kilit) // K2: önce grpcall kilidi, sonra dm_calls (for update), sonra cm
    expect(f).toContain("order by dc.id for update loop")
    const o = fonk('grup_arama_olayi')
    expect(o).toContain("'participants', kisiler")
    expect(o).toContain('jsonb_agg(cm.user_id order by cm.joined_at, cm.user_id)')
  })

  it('K3: üyelik/kuruculuk kilitten SONRA yeniden denetlenir', () => {
    const a = fonk('add_group_member')
    expect(a.indexOf('public.benim_grubum(tid)', a.indexOf("'dmgroup:'"))).toBeGreaterThan(a.indexOf("'dmgroup:'"))
    const r = fonk('remove_group_member')
    const k = r.indexOf("'dmgroup:'")
    expect(r.indexOf('t := public.benim_grubum(tid)', k)).toBeGreaterThan(k)
    expect(r.indexOf('t.owner_id is distinct from ben', k)).toBeGreaterThan(k)
    const l = fonk('leave_group')
    expect(l.indexOf('t := public.benim_grubum(tid)', l.indexOf("'dmgroup:'"))).toBeGreaterThan(l.indexOf("'dmgroup:'"))
  })

  it('K1: cevaplanmış aramada timeout çağıranı çıkarır (erken dönüş yok)', () => {
    const l = fonk('leave_group_call')
    expect(l).not.toContain("if reason = 'timeout' then return")
    expect(l).toContain('update public.dm_call_members cm set left_at = now()')
  })

  it('bayat katılımcı ping sırasında çıkarılır (olay gider); ping grpcall kilidi alır', () => {
    const p = fonk('ping_group_call')
    expect(p).toContain("hashtextextended('grpcall:' || tid::text, 0)")
    expect(p).toContain('perform public.grup_aramasi_temizle(ping_group_call.cid)')
  })
})
