/** An office receives only the server-authorized, anonymized activity snapshot. Fail closed on every read error. */
import { api, ApiError, type OfficeSnapshot } from './building-api';
import type { AgentSource, SourceEvent, Thread } from './source';
import { B } from './i18n/building';

export class SharedSource implements AgentSource {
  private list: Thread[] = [];
  private listeners: ((e: SourceEvent) => void)[] = [];
  private inflight = false;
  private stopped = false;
  private teamNames: string[] = [];
  private disconnected = false;

  constructor(private officeId: string) {}

  static async connect(id: string) {
    const source = new SharedSource(id);
    await source.refresh();
    const timer = setInterval(() => { if (!source.stopped && !source.inflight) void source.refresh(); }, 3000);
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    return source;
  }

  threads() { return this.list; }
  teams() { return this.teamNames; }
  subscribe(fn: (e: SourceEvent) => void) { this.listeners.push(fn); }
  totals() { return { runs: 0, tokens: 0, cost: 0, queued: this.list.filter((t) => t.status === 'waiting').length }; }
  private emit(e: SourceEvent) { this.listeners.forEach((fn) => fn(e)); }

  update(_dt: number) { /* Network freshness is independent of renderer frame rate. */ }

  private async refresh() {
    this.inflight = true;
    try {
      const snap = await api<OfficeSnapshot>(`/offices/${encodeURIComponent(this.officeId)}`);
      if (!Array.isArray(snap.agents)) throw new Error('Invalid shared office snapshot.');
      if (this.disconnected) { location.reload(); return; }
      if (!snap.agents.length && this.list.length) {
        // A pause/offline snapshot must clear old actors and inspector history, not animate them leaving.
        location.reload();
        return;
      }
      const agents = [...snap.agents].sort((a, b) => a.area.localeCompare(b.area) || a.id.localeCompare(b.id));
      // Keep same-area coworkers together while respecting the office's four six-seat pods.
      this.teamNames = Array.from({ length: 4 }, (_, i) => {
        const areas = [...new Set(agents.slice(i * 6, (i + 1) * 6).map((a) => a.area))];
        return areas.length > 2 ? B.moreAreas : areas.map((area) => B.areaLabels[area]).join(' / ');
      });
      const next = agents.map((a, i): Thread => ({
        id: a.id, name: a.name, title: B.areaLabels[a.area], workArea: B.areaLabels[a.area], provider: a.provider, model: '', team: Math.floor(i / 6),
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
    } catch (error) {
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        this.stopped = true;
        const own = new URL(location.href); own.searchParams.delete('source'); own.searchParams.delete('floor');
        location.replace(own);
        return;
      }
      console.warn('Shared office refresh failed', error);
      this.disconnected = true;
      // Cover the entire stale scene while retrying. Once access is revalidated,
      // recreate it so no departing actors or old inspector history survive.
      if (!document.querySelector('.shared-connection-cover')) {
        const cover = document.createElement('div'); cover.className = 'shared-connection-cover';
        const text = document.createElement('p'); text.textContent = B.connectionLost;
        const home = document.createElement('a'); const own = new URL(location.href);
        own.searchParams.delete('source'); own.searchParams.delete('floor'); home.href = own.href; home.textContent = B.own;
        cover.append(text, home); document.body.append(cover);
      }
    } finally { this.inflight = false; }
  }
}
