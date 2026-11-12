// realtime-js 2.119'un davranışını taklit eden sahte Supabase istemcisi (sadece kanallar):
//  - channel(topic) aynı konuda kanal varsa (ayrılma bitmemiş olsa bile) ESKİ nesneyi döner
//  - subscribe() kapalı olmayan kanalda hiçbir şey yapmaz (geri çağırma da gelmez)
//  - removeChannel asenkron: ayrılma onaylanınca kanal listeden çıkar
export function createFakeRealtime() {
  const rt = { channels: [], created: [], setAuthCalls: 0, removeGate: null, log: [] }

  class FakeChannel {
    constructor(topic, params) {
      this.topic = topic
      this.params = params
      this.state = 'closed'
      this.handlers = []
      this.sent = []
    }
    on(type, filter, cb) { this.handlers.push({ type, event: filter.event, cb }); return this }
    subscribe(cb) {
      if (this.state !== 'closed') return this // realtime-js: zaten açık/kapanıyor -> yok say
      this.state = 'joining'
      this.cb = cb
      Promise.resolve().then(() => {
        if (this.state !== 'joining') return
        this.state = 'joined'
        cb?.('SUBSCRIBED')
      })
      return this
    }
    async send(m) { this.sent.push(m); return 'ok' }
    // Varlık (presence): yayınlanan durumlar kaydedilir
    track(d) { (this.tracked ??= []).push(d); return Promise.resolve('ok') }
    untrack() { this.untracked = true; return Promise.resolve('ok') }
    presenceState() { return {} }
    deliver(event, payload) {
      for (const h of this.handlers) if (h.type === 'broadcast' && h.event === event) h.cb({ payload })
    }
  }

  rt.client = {
    channel(topic, params) {
      rt.log.push('channel')
      const var_olan = rt.channels.find((c) => c.topic === topic)
      if (var_olan) return var_olan
      const c = new FakeChannel(topic, params)
      rt.channels.push(c)
      rt.created.push(c)
      return c
    },
    async removeChannel(c) {
      c.state = 'leaving'
      await rt.removeGate
      await null
      c.state = 'closed'
      rt.channels = rt.channels.filter((x) => x !== c)
      return 'ok'
    },
    realtime: { setAuth: async () => { rt.setAuthCalls++; rt.log.push('setAuth') } },
  }
  return rt
}
