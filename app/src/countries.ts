/**
 * Area filter: OBIS-style areas built from the Marine Regions EEZ x IHO
 * intersect (see scripts/build_eez_data.py), e.g.
 *   "Canada: North Atlantic", "United Kingdom: Cayman Islands",
 *   "United Kingdom: all", "ABNJ: Indian Ocean".
 * Joint regimes and overlapping claims are not included.
 * A selection is a list of area ids; the API matches any of them (OR).
 */

export type AreaKind = 'home' | 'basin' | 'territory' | 'all' | 'abnj' | 'declared'

export interface AreaOption {
  /** Stable slug, e.g. `canada-north-atlantic`. */
  id: string
  name: string
  kind: AreaKind
  /** Programmes with data in this area (or, for whole-country areas, declaring the country). */
  programmes: number
}

export interface AreasResponse {
  source?: string
  items: AreaOption[]
}

/** Add the `area=` query param for a selection. */
export function appendAreaParams(params: URLSearchParams, areas: readonly string[]): void {
  if (areas.length) params.set('area', areas.join(','))
}

/** Stable key for a selection (order-insensitive). */
export function areaSelectionKey(areas: readonly string[]): string {
  return [...areas].sort().join(',')
}

/** Lowercase, strip accents, collapse punctuation — for type-ahead matching. */
export function normalizeAreaText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
