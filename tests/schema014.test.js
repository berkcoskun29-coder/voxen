// Çevrimdışı şema testi (tests/schema.test.js kalıbı): 014 sağlamlaştırma (v0.12.0)
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

const yol = 'supabase/migrations/014_saglamlastirma.sql'
const ham = existsSync(yol) ? readFileSync(yol, 'utf8') : ''
// Yorumlar atılır, küçük harf, tek boşluk
const sql = ham.replace(/--[^\n]*/g, '').toLowerCase().replace(/\s+/g, ' ')
const fonk = (ad, metin = sql) => {
  const i = metin.search(new RegExp(`create (or replace )?function public\\.${ad}\\(`))
  if (i < 0) return ''
  const govdeBasi = metin.indexOf('$$', i)
  return metin.slice(i, metin.indexOf('$$;', govdeBasi + 2) + 3)
}
// 013'teki tanım (karşılaştırma için)
const sql013 = readFileSync('supabase/migrations/013_roller.sql', 'utf8').replace(/--[^\n]*/g, '').toLowerCase().replace(/\s+/g, ' ')
const sql010 = readFileSync('supabase/migrations/010_ekler.sql', 'utf8').replace(/--[^\n]*/g, '').toLowerCase().replace(/\s+/g, ' ')

describe('014_saglamlastirma.sql', () => {
  it('dosya var', () => expect(existsSync(yol)).toBe(true))

  it('yalnız ekleme: sütun/tablo silme, yeniden adlandırma, imza değişikliği yok', () => {
    expect(sql).not.toMatch(/drop column|rename column|rename to|drop table|alter column|drop function/)
    // Var olan RPC'lerin dönüş türü aynı
    for (const [ad, donus] of [['reply_ok', 'returns boolean'], ['dm_reply_ok', 'returns boolean'], ['create_role', 'returns uuid'],
      ['update_role', 'returns void'], ['delete_role', 'returns void'], ['kick_member', 'returns void'], ['ek_silinebilir', 'returns boolean']]) {
      expect(fonk(ad), ad).toContain(donus)
      expect(fonk(ad, sql013 + sql010 + readFileSync('supabase/migrations/009_tepki_yanit_sabit.sql', 'utf8').toLowerCase().replace(/\s+/g, ' ')), ad).toContain(donus)
    }
  })

  it('v07 K-2: reply_ok üyelik, dm_reply_ok konuşma tarafı ister; eski şartlar korunur', () => {
    const r = fonk('reply_ok')
    expect(r).toContain('m.id = rid and m.channel_id = cid and m.deleted_at is null')
    expect(r).toContain('public.is_member(c.server_id)')
    expect(r).toContain('rid is null or')
    const d = fonk('dm_reply_ok')
    expect(d).toContain('public.is_dm_participant(tid)')
    expect(d).toContain("m.id = rid and m.thread_id = tid and m.deleted_at is null and m.kind = 'text'")
  })

  it('v11 K4: kick_member izni rol kilidinden SONRA denetler; 013 davranışı korunur', () => {
    const f = fonk('kick_member')
    const kilit = f.indexOf('perform public.rol_kilidi(sid);')
    expect(kilit).toBeGreaterThan(0)
    expect(f.indexOf("public.has_permission(sid, ben, 'kick_members')")).toBeGreaterThan(kilit)
    expect(f.indexOf('public.is_member(sid)')).toBeGreaterThan(kilit)
    expect(f).toContain("if public.uye_ust_sira(sid, uid) >= public.uye_ust_sira(sid, ben) then raise exception 'role_hierarchy'")
    expect(f).toContain('delete from public.voice_states where user_id = uid and server_id = sid;')
    expect(f).toContain('delete from public.server_members where server_id = sid and user_id = uid;')
    expect(f.indexOf("'roller'")).toBeLessThan(f.indexOf('delete from public.server_members'))
  })

  it('v11 K3: create_role rolsüz (üst sırası 0) sahip olmayana ROLE_HIERARCHY; kilit önce, sonra yetki', () => {
    const f = fonk('create_role')
    expect(f).toContain('ust := public.rol_yoneticisi(sid);')
    expect(f).toContain("if ust < 1 then raise exception 'role_hierarchy'")
    expect(f.indexOf('perform public.rol_kilidi(sid);')).toBeLessThan(f.indexOf('ust := public.rol_yoneticisi(sid);'))
    // 013'teki diğer denetimler aynı
    for (const parca of ["raise exception 'role_name'", "raise exception 'role_color'", "raise exception 'permission_not_held'", "raise exception 'role_limit'", 'values (sid, yeni_ad, renk, 1, dizi)']) {
      expect(f, parca).toContain(parca)
    }
  })

  it('v11 K2: rolu_ustteki_tasiyor — sahip ve çağıran sayılmaz, eşit/üst sıra sayılır; içeride kalır', () => {
    const y = fonk('rolu_ustteki_tasiyor')
    expect(y).toContain('mr.role_id = rid and mr.server_id = sid')
    expect(y).toContain('mr.user_id <> auth.uid()')
    expect(y).toContain('s.owner_id = mr.user_id')
    expect(y).toContain('public.uye_ust_sira(sid, mr.user_id) >= ust')
    expect(sql).toContain('revoke all on function public.rolu_ustteki_tasiyor(uuid, uuid, int) from public, anon, authenticated;')
    expect(sql).not.toContain('grant execute on function public.rolu_ustteki_tasiyor')
  })

  it('v11 K2: delete_role ve update_role (yalnız izin kaldırırken) üstteki taşıyanda ROLE_HIERARCHY; sahip serbest; @herkes dışarıda', () => {
    const d = fonk('delete_role')
    expect(d).toContain("if ust < 2147483647 and public.rolu_ustteki_tasiyor(rid, r.server_id, ust) then raise exception 'role_hierarchy'")
    expect(d.indexOf('rolu_ustteki_tasiyor')).toBeLessThan(d.indexOf('delete from public.roles x where x.id = rid'))
    expect(d).toContain("raise exception 'default_role'")
    const u = fonk('update_role')
    expect(u).toContain('(select unnest(r.permissions) except select unnest(dizi)) as k(p)')
    expect(u).toContain('if not r.is_default and cardinality(kalkan) > 0 and ust < 2147483647 and public.rolu_ustteki_tasiyor(rid, r.server_id, ust) then raise exception \'role_hierarchy\'')
    expect(u.indexOf('rolu_ustteki_tasiyor')).toBeLessThan(u.indexOf('update public.roles x set permissions = dizi'))
    expect(u).toContain("raise exception 'permission_not_held'")
  })

  it('v11 K6: ek_silinenler (RLS açık, politika yok); kanal mesajı silinince yollar yazılır, eskiler temizlenir', () => {
    expect(sql).toContain('create table if not exists public.ek_silinenler ( path text primary key, channel_id uuid not null references public.channels(id) on delete cascade, deleted_at timestamptz not null default now() )')
    expect(sql).toContain('alter table public.ek_silinenler enable row level security;')
    expect(sql).not.toMatch(/create policy \w+ on public\.ek_silinenler/)
    const t = fonk('mesaj_silinince_temizle')
    const yaz = t.indexOf('insert into public.ek_silinenler (path, channel_id) select a.path, new.channel_id from public.attachments a where a.message_id = new.id')
    expect(yaz).toBeGreaterThan(0)
    expect(yaz).toBeLessThan(t.indexOf('delete from public.attachments a where a.message_id = new.id'))
    expect(t).toContain("delete from public.ek_silinenler s where s.deleted_at < now() - interval '1 day'")
    // 010'daki temizlikler aynen
    for (const parca of ['delete from public.message_reactions r where r.message_id = new.id', 'delete from public.message_pins p where p.message_id = new.id',
      'delete from public.dm_message_reactions r where r.message_id = new.id', 'delete from public.dm_message_pins p where p.message_id = new.id',
      'delete from public.attachments a where a.dm_message_id = new.id']) {
      expect(t, parca).toContain(parca)
    }
  })

  it('v11 K6: ek_silinebilir — kendi klasörüm serbest; moderatör yalnız son 1 günde silinmiş mesajın bağsız ekini', () => {
    const f = fonk('ek_silinebilir')
    expect(f).toContain('if p[3] = auth.uid()::text then return true;')
    expect(f).toContain("s.path = yol and s.channel_id = p[2]::uuid and s.deleted_at > now() - interval '1 day'")
    expect(f).toContain("public.has_permission(c.server_id, auth.uid(), 'manage_messages')")
    expect(f).toContain('not exists (select 1 from public.attachments a where a.path = yol)')
    expect(sql).toContain('grant execute on function public.ek_silinebilir(text) to authenticated;')
  })

  it('v09 K5: kurucu hesabı silinince en eski üyeye devir (tetikleyici) ve sahipsiz eski grupların onarımı', () => {
    const f = fonk('grup_kurucusu_devret')
    expect(f).toContain('returns trigger')
    expect(f).toContain('m.thread_id = new.id and m.user_id <> old.owner_id order by m.joined_at, m.user_id limit 1')
    expect(f).toContain('update public.dm_threads t set owner_id = yeni where t.id = new.id and t.owner_id is null')
    expect(sql).toContain('create trigger dm_threads_kurucu_devret after update of owner_id on public.dm_threads for each row when (new.is_group and new.owner_id is null and old.owner_id is not null) execute function public.grup_kurucusu_devret();')
    expect(sql).toContain('revoke all on function public.grup_kurucusu_devret() from public, anon, authenticated;')
    expect(sql).toMatch(/update public\.dm_threads t set owner_id = \(select m\.user_id from public\.dm_members m where m\.thread_id = t\.id order by m\.joined_at, m\.user_id limit 1\) where t\.is_group and t\.owner_id is null/)
  })

  it('inceleme K2/K3/Y1: kurucu devri dmgroup: kilidini yalnız DENER (beklemez), üyeleri ondan sonra okur, kalan üyelere "degisti" gönderir', () => {
    const f = fonk('grup_kurucusu_devret')
    const kilit = f.indexOf("perform pg_try_advisory_xact_lock(hashtextextended('dmgroup:' || new.id::text, 0));")
    expect(kilit).toBeGreaterThan(0)
    expect(f).not.toContain('perform pg_advisory_xact_lock') // beklemek RI satır kilidiyle deadlock yaratırdı
    expect(f.indexOf('select m.user_id into yeni')).toBeGreaterThan(kilit)
    expect(f).toContain("jsonb_build_object('tablo', 'dm_threads', 'islem', 'update'), 'degisti', 'user:' || kisi::text, true")
    expect(f).toContain('exception when others then null;')
  })

  it('inceleme KR1: sunucuya katılınca "degisti" (server_members INSERT) yayınlanır', () => {
    expect(sql).toContain('create trigger server_members_eklendi after insert on public.server_members for each row execute function public.sunucu_olayi_gonder();')
    // 006'daki fonksiyon INSERT'i destekliyor (new'dan okur)
    const s006 = readFileSync('supabase/migrations/006_temel_ozellikler.sql', 'utf8').replace(/--[^\n]*/g, '').toLowerCase().replace(/\s+/g, ' ')
    const f = fonk('sunucu_olayi_gonder', s006)
    expect(f).toContain('satir := to_jsonb(new);')
    expect(f).toContain("'user_id', case when tg_table_name = 'server_members' then satir ->> 'user_id' end")
  })

  it('her fonksiyon: security definer + search_path; RPC\'ler anon kapalı, authenticated açık', () => {
    for (const e of sql.matchAll(/create or replace function public\.(\w+)\(/g)) {
      const f = fonk(e[1])
      expect(f, e[1]).toContain('security definer')
      expect(f, e[1]).toContain('set search_path = public')
    }
    for (const imza of ['reply_ok(bigint, uuid)', 'dm_reply_ok(bigint, uuid)', 'create_role(uuid, text, text, text[])',
      'update_role(uuid, text, text, text[], boolean)', 'delete_role(uuid)', 'kick_member(uuid, uuid)', 'ek_silinebilir(text)']) {
      expect(sql, imza).toContain(`revoke all on function public.${imza} from public, anon;`)
      expect(sql, imza).toContain(`grant execute on function public.${imza} to authenticated;`)
    }
  })
})
