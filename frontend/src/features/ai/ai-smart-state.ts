// ai-smart-state.ts — the library's « smart » search ranking, as the mod list reads it.
//
// A separate, dependency-free module on purpose: the mod list imports it at start-up, and the
// ranking itself (ai-ask.ts, the Rust `ai_ask` call, Laya) stays lazy until the toggle is used.

let _rank: Map<string, number> | null = null;
let _query = '';

/** The rank of each mod id for `query` (0 = best), or null when smart search is off / stale. */
export function smartRank(query: string): Map<string, number> | null {
    return _rank && query && _query === query ? _rank : null;
}

export function setSmartRank(ids: string[] | null, query: string): void {
    _rank = ids ? new Map(ids.map((id, i) => [id, i])) : null;
    _query = ids ? query : '';
}
