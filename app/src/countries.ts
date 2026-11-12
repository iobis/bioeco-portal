/** Sovereign countries (and high seas) used by the EEZ country filter. */
export interface CountryOption {
  /** Sovereign ISO3 code, or `ABNJ` for high seas. */
  iso: string
  name: string
  /** Overseas territories / EEZ units that roll up to this country. */
  territories: string[]
  landlocked: boolean
  /** Programmes tagged with this country (spatially or via schema:country). */
  programmes: number
}

export interface CountriesResponse {
  source?: string
  items: CountryOption[]
}

export const HIGH_SEAS_ISO = 'ABNJ'

export function appendCountryParams(params: URLSearchParams, countries: readonly string[]): void {
  if (countries.length) params.set('country', countries.join(','))
}

/** Stable key for a selection (order-insensitive). */
export function countrySelectionKey(countries: readonly string[]): string {
  return [...countries].sort().join(',')
}

/** Lowercase, strip accents, collapse punctuation — for type-ahead matching. */
export function normalizeCountryText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
