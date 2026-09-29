import { useId, useState, type CSSProperties } from 'react'
import {
  DEFAULT_TIME_RANGE,
  isFullTimeRange,
  TIME_RANGE_MAX_YEAR,
  TIME_RANGE_MIN_YEAR,
  type TimeRange,
} from '../timeRange'

interface TimeRangeSliderProps {
  value: TimeRange
  onChange: (range: TimeRange) => void
}

export function TimeRangeSlider({ value, onChange }: TimeRangeSliderProps) {
  const labelId = useId()
  const [activeThumb, setActiveThumb] = useState<'start' | 'end' | null>(null)
  const span = TIME_RANGE_MAX_YEAR - TIME_RANGE_MIN_YEAR
  const startPct = ((value.startYear - TIME_RANGE_MIN_YEAR) / span) * 100
  const endPct = ((value.endYear - TIME_RANGE_MIN_YEAR) / span) * 100
  const isFiltered = !isFullTimeRange(value)

  const setStart = (raw: number) => {
    const startYear = Math.min(raw, value.endYear)
    onChange({ startYear, endYear: value.endYear })
  }

  const setEnd = (raw: number) => {
    const endYear = Math.max(raw, value.startYear)
    onChange({ startYear: value.startYear, endYear })
  }

  return (
    <div className="map-time-bar" role="group" aria-labelledby={labelId}>
      <div className="map-time-bar-header">
        <span id={labelId} className="map-eov-widget-title">
          Time range
        </span>
        <div className="map-time-bar-meta">
          <span className="map-time-bar-years" aria-live="polite">
            {value.startYear}
            <span className="map-time-bar-sep">–</span>
            {value.endYear}
          </span>
          {isFiltered ? (
            <button
              type="button"
              className="map-time-bar-reset"
              onClick={() => onChange(DEFAULT_TIME_RANGE)}
            >
              Reset
            </button>
          ) : null}
        </div>
      </div>

      <div
        className="map-time-range"
        style={
          {
            '--time-start': `${startPct}%`,
            '--time-end': `${endPct}%`,
          } as CSSProperties
        }
      >
        <div className="map-time-range-track" aria-hidden="true" />
        <div className="map-time-range-fill" aria-hidden="true" />
        <input
          type="range"
          className={`map-time-range-input map-time-range-input--start${
            activeThumb === 'start' ? ' is-active' : ''
          }`}
          min={TIME_RANGE_MIN_YEAR}
          max={TIME_RANGE_MAX_YEAR}
          step={1}
          value={value.startYear}
          aria-label="Start year"
          onPointerDown={() => setActiveThumb('start')}
          onPointerUp={() => setActiveThumb(null)}
          onChange={(e) => setStart(Number(e.target.value))}
        />
        <input
          type="range"
          className={`map-time-range-input map-time-range-input--end${
            activeThumb === 'end' ? ' is-active' : ''
          }`}
          min={TIME_RANGE_MIN_YEAR}
          max={TIME_RANGE_MAX_YEAR}
          step={1}
          value={value.endYear}
          aria-label="End year"
          onPointerDown={() => setActiveThumb('end')}
          onPointerUp={() => setActiveThumb(null)}
          onChange={(e) => setEnd(Number(e.target.value))}
        />
      </div>

      <div className="map-time-range-bounds" aria-hidden="true">
        <span>{TIME_RANGE_MIN_YEAR}</span>
        <span>{TIME_RANGE_MAX_YEAR}</span>
      </div>
    </div>
  )
}
