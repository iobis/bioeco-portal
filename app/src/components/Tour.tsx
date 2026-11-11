import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { MapLayerMode } from '../urlState'

export interface TourStep {
  title: string
  body: ReactNode
  /** Value of a `data-tour` attribute to spotlight. All matching elements are highlighted together. Omit for a centred card. */
  target?: string
  /** Map layer to switch to before showing this step (so layer-specific controls are visible). */
  layer?: MapLayerMode
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: 'Welcome to the GOOS BioEco Portal',
    body: (
      <>
        <p>
          The BioEco Portal shows metadata about ocean observing programmes that monitor BioEco Essential Ocean Variables (EOVs), alongside data published to OBIS that has been identified as EOV-relevant. The Portal does not host data itself, but links to it in OBIS. Currently not all EOV data in OBIS has been identified, so the map may not yet show all available data for a given EOV. The Portal is a work in progress and we welcome your feedback!
        </p>
        <p>This short tour walks through the main panels. You can leave at any time and reopen it from the Portal Tour button.</p>
      </>
    ),
  },
  {
    title: 'Search programmes',
    target: 'search',
    layer: 'programmes',
    body: (
      <p>
        Type here to search programmes by name or description. The search is combined with any filters you set on the map, so the list only shows programmes that match everything.
      </p>
    ),
  },
  {
    title: 'Programme list',
    target: 'programme-list',
    layer: 'programmes',
    body: (
      <>
        <p>
          Each entry shows a programme and the metadata available about it, e.g., a short description and the EOVs it observes. Hover over a programme name to see the geographic region the program covers, where this information is available. Click programme names to open the full programme metadata record, including contacts, readiness and links to its OBIS data.
        </p>
        <p>The list loads more programmes as you scroll.</p>
      </>
    ),
  },
  {
    title: 'The map',
    target: 'map',
    layer: 'programmes',
    body: (
      <>
        <p>
          The map shows data in grid cells, coloured by how many programmes (or OBIS datasets) fall inside each one. Drag to pan and scroll to zoom.
        </p>
        <p>
          <strong>Click a cell</strong> to filter the programme list to that area. Use the clear button above the
          search box to remove the area filter.
        </p>
      </>
    ),
  },
  {
    title: 'Map layers',
    target: 'map-layer',
    layer: 'programmes',
    body: (
      <ul>
        <li>
          <strong>Programmes</strong>: number of observing programmes conducting EOV monitoring activities per cell.
        </li>
        <li>
          <strong>EOVs</strong>: number of EOVs monitored per cell, providing a quick view of EOV coverage.
        </li>
        <li>
          <strong>Data</strong>: OBIS occurrence records per cell, showing where data has actually been published. Not all OBIS data that is potentially EOV-relevant has been identified yet, as EOV-tagging in OBIS is a work in progress.
        </li>
      </ul>
    ),
  },
  {
    title: 'EOV filter',
    target: 'eov-filter',
    layer: 'programmes',
    body: (
      <p>
        Tick one or more Essential Ocean Variables to only show programmes or datasets that monitor them. The map, the
        programme list and the search all update together. Leave everything unticked to see all EOVs.
      </p>
    ),
  },
  {
    title: 'Readiness and status',
    target: 'programme-filters',
    layer: 'programmes',
    body: (
      <>
        <p>
          Filter programmes by readiness level (L1 Idea to L9 Sustained) in three areas: <strong>data</strong>,{' '}
          <strong>requirements</strong> and <strong>coordination</strong>. Click a level to toggle it, or shift-click to select a range.
        </p>
        <p>
          <strong>Status</strong> limits the list to active or inactive programmes.
        </p>
      </>
    ),
  },
  {
    title: 'Data layer',
    target: 'eov-filter',
    layer: 'data',
    body: (
      <>
        <p>
          On the <strong>Data</strong> layer, the map shows OBIS occurrence records, and the EOV filter only displays datasets relevant to the selected EOVs.
        </p>
        <p>
          <strong>Click a cell</strong> to list the OBIS datasets with records in that area. Clicking a dataset name opens its OBIS record. You can also download the individually selected dataset by clicking the download button, under the title.
        </p>
      </>
    ),
  },
  {
    title: 'Time range',
    target: 'time-range',
    layer: 'data',
    body: (
      <p>
        When viewing the <strong>Data</strong> layer, drag the handles to filter OBIS records to specific temporal range.
      </p>
    ),
  },
  {
    title: 'Display options and legend',
    target: 'display-options',
    body: (
      <p>
        Change the colour scheme and opacity of the grid overlay, and turn cell counts on or off. The legend in the bottom left corner shows what each colour means for the current layer.
        You can toggle the map between Web Mercator (WGS:3857) projection and Globe using the button in the top left corner of the map.
      </p>
    ),
  },
  {
    title: 'More pages',
    target: 'nav',
    body: (
      <>
        <p>
          Use <strong>Submit or Update an Entry</strong> to add your programme, and <strong>Send Feedback</strong> to submit a GitHub issue to suggest improvements to this Portal. Click <strong>Portal Tour</strong> to see this guide again.
        </p>
        <p>
          The <strong>Map</strong> page shows the interactive map of the EOV programmes and EOV-tagged OBIS data. The <strong>Readiness</strong> page summarises readiness levels across all programmes. The <strong>Data quality</strong> page summarises issues found with programme metadata. The <strong>About</strong> page provides more information about the GOOS BioEco Portal and BioEco EOVs.
        </p>
        
      </>
    ),
  },
]

const STORAGE_KEY = 'bioeco-tour-seen'

export function hasSeenTour(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function markTourSeen() {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // storage unavailable (private mode etc.) – the tour will simply show again next time
  }
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

const SPOTLIGHT_PAD = 6
const CARD_GAP = 14
const CARD_WIDTH = 360
const VIEWPORT_MARGIN = 12

function measureTarget(target: string | undefined): Rect | null {
  if (!target) return null
  const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`))
  const rects = els.map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
  if (!rects.length) return null
  const top = Math.max(0, Math.min(...rects.map((r) => r.top)) - SPOTLIGHT_PAD)
  const left = Math.max(0, Math.min(...rects.map((r) => r.left)) - SPOTLIGHT_PAD)
  const bottom = Math.min(window.innerHeight, Math.max(...rects.map((r) => r.bottom)) + SPOTLIGHT_PAD)
  const right = Math.min(window.innerWidth, Math.max(...rects.map((r) => r.right)) + SPOTLIGHT_PAD)
  return { top, left, width: right - left, height: bottom - top }
}

/** Place the card beside the spotlight on whichever side has the most room. */
function cardPosition(rect: Rect | null, cardHeight: number): CSSProperties {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(CARD_WIDTH, vw - VIEWPORT_MARGIN * 2)
  if (!rect || vw < 640) {
    // Centred card, or pinned to the bottom on small screens so it doesn't cover the target.
    if (rect && vw < 640) {
      return { width, left: (vw - width) / 2, bottom: VIEWPORT_MARGIN }
    }
    return { width, left: (vw - width) / 2, top: Math.max(VIEWPORT_MARGIN, (vh - cardHeight) / 2) }
  }
  const clampTop = (t: number) => Math.min(Math.max(VIEWPORT_MARGIN, t), vh - cardHeight - VIEWPORT_MARGIN)
  const clampLeft = (l: number) => Math.min(Math.max(VIEWPORT_MARGIN, l), vw - width - VIEWPORT_MARGIN)

  const space = {
    right: vw - (rect.left + rect.width),
    left: rect.left,
    bottom: vh - (rect.top + rect.height),
    top: rect.top,
  }
  if (space.right >= width + CARD_GAP + VIEWPORT_MARGIN) {
    return { width, left: rect.left + rect.width + CARD_GAP, top: clampTop(rect.top) }
  }
  if (space.left >= width + CARD_GAP + VIEWPORT_MARGIN) {
    return { width, left: rect.left - width - CARD_GAP, top: clampTop(rect.top) }
  }
  if (space.bottom >= cardHeight + CARD_GAP + VIEWPORT_MARGIN) {
    return { width, left: clampLeft(rect.left), top: rect.top + rect.height + CARD_GAP }
  }
  if (space.top >= cardHeight + CARD_GAP + VIEWPORT_MARGIN) {
    return { width, left: clampLeft(rect.left), top: rect.top - cardHeight - CARD_GAP }
  }
  // Target fills most of the screen (e.g. the map): float the card in the middle.
  return { width, left: (vw - width) / 2, top: Math.max(VIEWPORT_MARGIN, (vh - cardHeight) / 2) }
}

interface TourProps {
  open: boolean
  onClose: () => void
  /** Called before each step that needs a specific map layer. */
  onLayerChange: (layer: MapLayerMode) => void
  steps?: TourStep[]
}

export function Tour({ open, onClose, onLayerChange, steps = TOUR_STEPS }: TourProps) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [cardHeight, setCardHeight] = useState(240)
  const cardRef = useRef<HTMLDivElement>(null)
  const step = steps[index]

  useEffect(() => {
    if (open) setIndex(0)
  }, [open])

  useEffect(() => {
    if (open && step.layer) onLayerChange(step.layer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index])

  const remeasure = useCallback(() => {
    if (!step) return
    const first = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null
    first?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    setRect(measureTarget(step.target))
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight)
  }, [step])

  // Measure after the layer switch has rendered; poll briefly since some panels appear after data loads.
  useLayoutEffect(() => {
    if (!open) return
    remeasure()
    const timers = [50, 200, 600].map((ms) => window.setTimeout(remeasure, ms))
    window.addEventListener('resize', remeasure)
    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener('resize', remeasure)
    }
  }, [open, remeasure])

  const finish = useCallback(() => {
    markTourSeen()
    onClose()
  }, [onClose])

  const next = useCallback(() => {
    if (index >= steps.length - 1) finish()
    else setIndex((i) => i + 1)
  }, [index, steps.length, finish])

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, finish, next, back])

  useEffect(() => {
    if (open) cardRef.current?.focus()
  }, [open, index])

  if (!open || !step) return null

  const isLast = index === steps.length - 1

  return (
    <div className="tour-root">
      {/* Blocks interaction with the page while the tour is open. */}
      <div className={`tour-backdrop${rect ? '' : ' tour-backdrop--dim'}`} />
      {rect && (
        <div
          className="tour-spotlight"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      )}
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        style={cardPosition(rect, cardHeight)}
      >
        <div className="tour-card-head">
          <span className="tour-step-count">
            {index + 1} of {steps.length}
          </span>
          <button type="button" className="tour-close" aria-label="Close tour" onClick={finish}>
            ×
          </button>
        </div>
        <h2 id="tour-title" className="tour-title">
          {step.title}
        </h2>
        <div className="tour-body">{step.body}</div>
        <div className="tour-footer">
          <div className="tour-dots" role="tablist" aria-label="Tour pages">
            {steps.map((s, i) => (
              <button
                key={s.title}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Go to page ${i + 1}: ${s.title}`}
                className={`tour-dot${i === index ? ' is-active' : ''}`}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
          <div className="tour-actions">
            {index > 0 ? (
              <button type="button" className="tour-btn" onClick={back}>
                Back
              </button>
            ) : (
              <button type="button" className="tour-btn tour-btn--ghost" onClick={finish}>
                Skip
              </button>
            )}
            <button type="button" className="tour-btn tour-btn--primary" onClick={next}>
              {isLast ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
