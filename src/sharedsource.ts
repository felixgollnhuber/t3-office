/** An office receives only the server-authorized, anonymized activity snapshot. Fail closed on every read error. */
import { api, type OfficeSnapshot } from './building-api';
import type { AgentSource, SourceEvent, Thread } from './source';

export class SharedSource implements AgentSource {
  private list: Thread[] = [];
  private listeners: ((e: SourceEvent) => void)[] = [];
  private nextRefresh = Date.now() + 3000;
  private inflight = false;
  private stopped = false;

  constructor(private officeId: string) {}

  static async connect(id: string) {
    const source = new SharedSource(id);
    await source.refresh();
    return source;
  }

  threads() { return this.list; }
  subscribe(fn: (e: SourceEvent) => void) { this.listeners.push(fn); }
  totals() { return { runs: 0, tokens: 0, cost: 0, queued: this.list.filter((t) => t.status === 'waiting').length }; }
  private emit(e: SourceEvent) { this.listeners.forEach((fn) => fn(e)); }

  update(_dt: number) {
    // Privacy freshness follows wall time, not the renderer's capped animation delta.
    if (!this.stopped && !this.inflight && Date.now() >= this.nextRefresh) {
      this.nextRefresh = Date.now() + 3000;
      void this.refresh();
    }
  }

  private async refresh() {
    this.inflight = true;
    try {
      const snap = await api<OfficeSnapshot>(`/offices/${encodeURIComponent(this.officeId)}`);
      const next = snap.agents.map((a, i): Thread => ({
        id: a.id, name: a.name, title: 'Shared activity', provider: a.provider, model: '', team: Math.floor(i / 6),
        status: a.status, tps: 0, toolCalls: 0, files: 0, context: 0, cost: 0, settled: false,
      }));
      const keep = new Set(next.map((a) => a.id));
      for (const old of this.list) if (!keep.has(old.id)) this.emit({ type: 'settle', id: old.id });
      for (const t of next) {
        const old = this.list.find((o) => o.id === t.id);
        if (!old) this.emit({ type: 'add', thread: t });
        else {
          const from = old.status;
          Object.assign(old, t);
          next[next.indexOf(t)] = old;
          if (from !== t.status) this.emit({ type: 'status', id: t.id, from, to: t.status });
        }
      }
      this.list = next;
    } catch {
      this.list.forEach((t) => this.emit({ type: 'settle', id: t.id }));
      this.list = [];
      // Remove the entire scene, including workers walking out and open inspector history.
      // The parent validates this message's origin and iframe before clearing it.
      if (window.parent !== window) window.parent.postMessage({ type: 'office-access-lost', id: this.officeId }, location.origin);
      else document.body.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Office unavailable. Return to the building to reconnect.' }));
      this.stopped = true;
    } finally { this.inflight = false; }
  }
}
