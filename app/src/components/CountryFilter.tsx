import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { HIGH_SEAS_ISO, normalizeCountryText, type CountryOption } from '../countries'

interface CountryFilterProps {
  countries: CountryOption[]
  selected: string[]
  onChange: (isos: string[]) => void
}

interface MatchedOption {
  country: CountryOption
  /** Territory that matched the query, when the country name itself did not. */
  via: string | null
}

const MAX_OPTIONS = 60

/** Type-ahead multi-select for countries (EEZs), shown as removable chips. */
export function CountryFilter({ countries, selected, onChange }: CountryFilterProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()

  const byIso = useMemo(() => {
    const m = new Map<string, CountryOption>()
    for (const c of countries) m.set(c.iso, c)
    return m
  }, [countries])

  const options = useMemo<MatchedOption[]>(() => {
    const q = normalizeCountryText(query)
    const out: MatchedOption[] = []
    for (const country of countries) {
      if (selected.includes(country.iso) || country.programmes === 0) continue
      if (!q) {
        out.push({ country, via: null })
        continue
      }
      if (normalizeCountryText(country.name).includes(q) || country.iso.toLowerCase() === q) {
        out.push({ country, via: null })
        continue
      }
      const territory = country.territories.find((t) => normalizeCountryText(t).includes(q))
      if (territory) out.push({ country, via: territory })
    }
    // High seas first, then alphabetical.
    out.sort((a, b) => {
      if (a.country.iso === HIGH_SEAS_ISO) return -1
      if (b.country.iso === HIGH_SEAS_ISO) return 1
      return a.country.name.localeCompare(b.country.name)
    })
    return out.slice(0, MAX_OPTIONS)
  }, [countries, selected, query])

  const select = (iso: string) => {
    onChange([...selected, iso])
    setQuery('')
    setActiveIndex(0)
    inputRef.current?.focus()
  }

  const remove = (iso: string) => onChange(selected.filter((s) => s !== iso))

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
        select(option.country.iso)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    } else if (e.key === 'Backspace' && !query && selected.length) {
      remove(selected[selected.length - 1])
    }
  }

  const showList = open && options.length > 0

  return (
    <div className="country-filter">
      {selected.length ? (
        <ul className="country-filter-chips" aria-label="Selected countries">
          {selected.map((iso) => (
            <li key={iso} className="country-filter-chip">
              <span>{byIso.get(iso)?.name ?? iso}</span>
              <button
                type="button"
                className="country-filter-chip-remove"
                aria-label={`Remove ${byIso.get(iso)?.name ?? iso}`}
                onClick={() => remove(iso)}
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
        placeholder={selected.length ? 'Add another country…' : 'Search countries or territories…'}
        value={query}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${listboxId}-${activeIndex}` : undefined}
        aria-label="Filter by country (EEZ)"
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
          {options.map(({ country, via }, i) => (
            <li
              key={country.iso}
              id={`${listboxId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`country-filter-option${i === activeIndex ? ' is-active' : ''}`}
              // Keep focus in the input so blur doesn't close the list before the click.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => select(country.iso)}
            >
              <span className="country-filter-option-name">
                {country.name}
                {via ? <span className="country-filter-option-via"> · {via}</span> : null}
              </span>
              <span className="country-filter-option-count">{country.programmes}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {selected.length ? (
        <p className="country-filter-hint">
          Programmes whose area overlaps the selected EEZs, or that list the country in their metadata.
        </p>
      ) : null}
    </div>
  )
}
