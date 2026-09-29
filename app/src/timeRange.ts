/** Practical year bounds for the Data-layer time slider (OBIS has sparse pre-1950 data). */
export const TIME_RANGE_MIN_YEAR = 1950
export const TIME_RANGE_MAX_YEAR = new Date().getFullYear()

export interface TimeRange {
  startYear: number
  endYear: number
}

export const DEFAULT_TIME_RANGE: TimeRange = {
  startYear: TIME_RANGE_MIN_YEAR,
  endYear: TIME_RANGE_MAX_YEAR,
}

export function clampYear(year: number): number {
  return Math.min(TIME_RANGE_MAX_YEAR, Math.max(TIME_RANGE_MIN_YEAR, Math.round(year)))
}

export function normalizeTimeRange(range: TimeRange): TimeRange {
  const startYear = clampYear(range.startYear)
  const endYear = clampYear(range.endYear)
  if (startYear <= endYear) return { startYear, endYear }
  return { startYear: endYear, endYear: startYear }
}

export function isFullTimeRange(range: TimeRange): boolean {
  return range.startYear <= TIME_RANGE_MIN_YEAR && range.endYear >= TIME_RANGE_MAX_YEAR
}

/** Parse `YYYY` or `YYYY-MM-DD` into a clamped year, or null if invalid. */
export function parseYearParam(value: string | null): number | null {
  if (!value?.trim()) return null
  const match = value.trim().match(/^(\d{4})(?:-\d{2}-\d{2})?$/)
  if (!match) return null
  const year = Number(match[1])
  if (!Number.isInteger(year)) return null
  if (year < TIME_RANGE_MIN_YEAR || year > TIME_RANGE_MAX_YEAR) return null
  return year
}

export function yearToStartDate(year: number): string {
  return `${year}-01-01`
}

export function yearToEndDate(year: number): string {
  return `${year}-12-31`
}

/** OBIS query params — omit a bound when it matches the full slider range. */
export function timeRangeToObisParams(range: TimeRange): {
  startdate?: string
  enddate?: string
} {
  const normalized = normalizeTimeRange(range)
  const params: { startdate?: string; enddate?: string } = {}
  if (normalized.startYear > TIME_RANGE_MIN_YEAR) {
    params.startdate = yearToStartDate(normalized.startYear)
  }
  if (normalized.endYear < TIME_RANGE_MAX_YEAR) {
    params.enddate = yearToEndDate(normalized.endYear)
  }
  return params
}

export function appendTimeRangeParams(params: URLSearchParams, range: TimeRange): void {
  const { startdate, enddate } = timeRangeToObisParams(range)
  if (startdate) params.set('startdate', startdate)
  if (enddate) params.set('enddate', enddate)
}
