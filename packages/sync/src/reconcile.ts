// @cookie/sync — reconciliación por cursor (SDD §6.3). Puro y testeable.
export interface RemoteEvent {
  readonly seq: number;
  readonly eventId: string;
  readonly type: string;
  readonly entityId: string;
}

export interface EventsPage {
  readonly events: RemoteEvent[];
  readonly currentSeq: number;
  readonly snapshotRequired: boolean;
}

export interface CursorState {
  lastSeq: number;
  appliedIds: string[];
}

export interface CursorBackend {
  load(): Promise<CursorState>;
  save(state: CursorState): Promise<void>;
}

export function memoryCursorBackend(initialSeq = 0): CursorBackend {
  let state: CursorState = { lastSeq: initialSeq, appliedIds: [] };
  return {
    load: async () => ({ ...state, appliedIds: [...state.appliedIds] }),
    save: async (s) => {
      state = { lastSeq: s.lastSeq, appliedIds: [...s.appliedIds].slice(-500) };
    },
  };
}

export interface ReconcileResult {
  /** Eventos nuevos aplicados en orden. */
  readonly applied: RemoteEvent[];
  /** True si el cliente debe recargar snapshot (timeline completo). */
  readonly snapshot: boolean;
  readonly currentSeq: number;
}

/**
 * Pide el delta desde el cursor y aplica en orden, ignorando duplicados por
 * eventId/seq. Detecta huecos: si el primer evento salta el cursor, pide
 * snapshot en vez de aplicar a ciegas.
 */
export async function reconcile(
  cursor: CursorBackend,
  fetchEvents: (afterSeq: number) => Promise<EventsPage>,
): Promise<ReconcileResult> {
  const state = await cursor.load();
  const page = await fetchEvents(state.lastSeq);
  if (page.snapshotRequired) {
    return { applied: [], snapshot: true, currentSeq: page.currentSeq };
  }
  const seen = new Set(state.appliedIds);
  const applied: RemoteEvent[] = [];
  let lastSeq = state.lastSeq;
  for (const e of page.events) {
    if (e.seq <= lastSeq || seen.has(e.eventId)) continue;
    if (e.seq > lastSeq + 1) {
      // Hueco: el lote no es contiguo con el cursor → snapshot.
      return { applied, snapshot: true, currentSeq: page.currentSeq };
    }
    seen.add(e.eventId);
    applied.push(e);
    lastSeq = e.seq;
  }
  await cursor.save({ lastSeq, appliedIds: [...seen] });
  return { applied, snapshot: false, currentSeq: page.currentSeq };
}
