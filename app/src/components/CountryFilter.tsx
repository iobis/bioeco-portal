import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { normalizeAreaText, type AreaOption } from '../countries'

interface AreaFilterProps {
  areas: AreaOption[]
  /** Selected area ids. */
  selected: string[]
  onChange: (ids: string[]) => void
}

const MAX_OPTIONS = 80

/**
 * Type-ahead multi-select for OBIS-style areas ("Canada: North Atlantic",
 * "United Kingdom: Cayman Islands", "ABNJ", ...), shown as removable chips.
 * Areas without programmes are hidden.
 */
export function AreaFilter({ areas, selected, onChange }: AreaFilterProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()

  const byId = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas])

  const searchable = useMemo(
    () => areas.map((area) => ({ area, text: normalizeAreaText(area.name) })),
    [areas],
  )

  // Keep the API order (ABNJ first, then alphabetical).
  const options = useMemo<AreaOption[]>(() => {
    const q = normalizeAreaText(query)
    return searchable
      .filter(({ area, text }) => area.programmes > 0 && !selected.includes(area.id) && (!q || text.includes(q)))
      .slice(0, MAX_OPTIONS)
      .map(({ area }) => area)
  }, [searchable, selected, query])

  const select = (id: string) => {
    onChange([...selected, id])
    setQuery('')
    setActiveIndex(0)
    inputRef.current?.focus()
  }

  const remove = (id: string) => onChange(selected.filter((s) => s !== id))

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActiveIndex((i) => Math.min(i + 1, Math.max(options.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      const option = options[activeIndex]
      if (open && option) {
        e.preventDefault()
        select(option.id)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    } else if (e.key === 'Backspace' && !query && selected.length) {
      remove(selected[selected.length - 1])
    }
  }

  const showList = open && options.length > 0
  const label = (id: string) => byId.get(id)?.name ?? id

  return (
    <div className="country-filter">
      {selected.length ? (
        <ul className="country-filter-chips" aria-label="Selected areas">
          {selected.map((id) => (
            <li key={id} className="country-filter-chip">
              <span>{label(id)}</span>
              <button
                type="button"
                className="country-filter-chip-remove"
                aria-label={`Remove ${label(id)}`}
                onClick={() => remove(id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        ref={inputRef}
        type="text"
        className="country-filter-input"
        placeholder={selected.length ? 'Add another area…' : 'Search countries, territories or ABNJ…'}
        value={query}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${listboxId}-${activeIndex}` : undefined}
        aria-label="Filter by country or area"
        onChange={(e) => {
          setQuery(e.target.value)
          setActiveIndex(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList ? (
        <ul id={listboxId} className="country-filter-options" role="listbox">
          {options.map((area, i) => (
            <li
              key={area.id}
              id={`${listboxId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`country-filter-option${i === activeIndex ? ' is-active' : ''}`}
              // Keep focus in the input so blur doesn't close the list before the click.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => select(area.id)}
            >
              <span className="country-filter-option-name">
                {area.name}
                {area.kind === 'declared' ? <span className="country-filter-option-via"> · from metadata</span> : null}
              </span>
              <span className="country-filter-option-count">{area.programmes}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {selected.length ? (
        <p className="country-filter-hint">
          Programmes with data in the selected areas. Whole-country entries (e.g. “Portugal: all”) also include
          programmes that list the country in their metadata. Areas:{' '}
          <a href="https://www.marineregions.org/" target="_blank" rel="noopener noreferrer">
            Marine Regions
          </a>{' '}
          EEZ × IHO v5 (VLIZ, CC-BY 4.0).
        </p>
      ) : null}
    </div>
  )
}
