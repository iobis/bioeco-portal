import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildEovResolver } from '../eovVocabulary'
import type { EovVocabulary } from '../eovVocabulary'
import type { ProgrammeStatus } from '../programmeStatus'
import {
  EMPTY_READINESS_SELECTION,
  appendReadinessParams,
  type ReadinessSelection,
} from '../readiness'

interface Eov {
  code?: string
  label?: string
  name?: string
  uri?: string
}

interface Project {
  id: string
  name: string
  description?: string
  url?: string
  eovs?: Eov[]
}

interface ProjectsResponse {
  total: number
  items: Project[]
}

interface ProjectListProps {
  onHoverProject?: (projectId: string | null) => void
  onSelectProject?: (projectId: string) => void
  cellBbox?: string | null
  onClearCellFilter?: () => void
  searchQuery?: string
  onSearchQueryChange?: (q: string) => void
  debouncedSearchQuery?: string
  eovCategories?: string[]
  eovVocabulary?: EovVocabulary | null
  programmeStatus?: ProgrammeStatus
  readiness?: ReadinessSelection
}

const PAGE_SIZE = 25
/** Wait before loading map geometry so scrolling the list does not fire a fetch per row. */
const HOVER_DELAY_MS = 400

function appendProjectListParams(
  params: URLSearchParams,
  {
    searchQuery,
    cellBbox,
    eovCategories,
    programmeStatus,
    readiness,
  }: {
    searchQuery: string
    cellBbox: string | null
    eovCategories: string[]
    programmeStatus: ProgrammeStatus
    readiness: ReadinessSelection
  },
) {
  params.set('include_geometry', 'false')
  if (searchQuery) params.set('name', searchQuery)
  if (cellBbox?.trim()) params.set('bbox', cellBbox.trim())
  if (eovCategories.length) params.set('eov_category', eovCategories.join(','))
  if (programmeStatus && programmeStatus !== 'all') params.set('status', programmeStatus)
  appendReadinessParams(params, readiness)
}

/** Group project EOVs by top-level category using vocabulary resolver; return entries with label and badge bg. */
function groupEovsByTopLevel(
  eovs: Eov[],
  resolve: (uri: string) => { code: string; label: string; badge: { bg: string; fg: string } } | null
): Array<{ key: string; label: string; bg: string }> {
  const byKey = new Map<string, { label: string; bg: string }>()
  for (const eov of eovs) {
    const uri = (eov.uri ?? eov.code ?? '').trim()
    const resolved = uri ? resolve(uri) : null
    if (!resolved) continue
    if (!byKey.has(resolved.code)) {
      byKey.set(resolved.code, { label: resolved.label, bg: resolved.badge.bg })
    }
  }
  return [...byKey.entries()].map(([key, { label, bg }]) => ({ key, label, bg }))
}


export function ProjectList({
  onHoverProject,
  onSelectProject,
  cellBbox = null,
  onClearCellFilter,
  searchQuery = '',
  onSearchQueryChange,
  debouncedSearchQuery = '',
  eovCategories = [],
  eovVocabulary = null,
  programmeStatus = 'all',
  readiness = EMPTY_READINESS_SELECTION,
}: ProjectListProps) {
  const [items, setItems] = useState<Project[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const requestIdRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const itemsLengthRef = useRef(0)
  const totalRef = useRef(0)
  const onHoverProjectRef = useRef(onHoverProject)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerOverIdRef = useRef<string | null>(null)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const resolveEov = useMemo(() => buildEovResolver(eovVocabulary), [eovVocabulary])

  onHoverProjectRef.current = onHoverProject

  itemsLengthRef.current = items.length
  totalRef.current = total

  const clearHoverTimer = () => {
    if (hoverTimerRef.current != null) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }

  const scheduleHover = (id: string | null) => {
    clearHoverTimer()
    if (!id) {
      onHoverProjectRef.current?.(null)
      return
    }
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null
      onHoverProjectRef.current?.(id)
    }, HOVER_DELAY_MS)
  }
  const scheduleHoverRef = useRef(scheduleHover)
  scheduleHoverRef.current = scheduleHover

  const handleItemMouseEnter = (id: string) => {
    pointerOverIdRef.current = id
    scheduleHover(id)
  }

  const handleItemMouseLeave = (id: string) => {
    if (pointerOverIdRef.current !== id) return
    pointerOverIdRef.current = null
    scheduleHover(null)
  }

  const listParams = useMemo(() => {
    const params = new URLSearchParams({ size: String(PAGE_SIZE) })
    appendProjectListParams(params, {
      searchQuery: debouncedSearchQuery,
      cellBbox,
      eovCategories,
      programmeStatus,
      readiness,
    })
    return params.toString()
  }, [debouncedSearchQuery, cellBbox, eovCategories, programmeStatus, readiness])

  useEffect(() => {
    pointerOverIdRef.current = null
    clearHoverTimer()
    onHoverProjectRef.current?.(null)
  }, [listParams])

  useEffect(() => {
    return () => {
      clearHoverTimer()
      onHoverProjectRef.current?.(null)
    }
  }, [])

  useEffect(() => {
    const list = listRef.current
    const root = list?.closest('.panel-content')
    if (!root) return

    const projectIdFromPoint = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)
      const item = el?.closest<HTMLElement>('.project-item')
      if (!item || !root.contains(item)) return null
      return item.dataset.projectId ?? null
    }

    const onPointerMove = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
    }

    const onScroll = () => {
      const pos = lastPointerRef.current
      const id = pos ? projectIdFromPoint(pos.x, pos.y) : pointerOverIdRef.current
      pointerOverIdRef.current = id
      onHoverProjectRef.current?.(null)
      scheduleHoverRef.current(id)
    }

    root.addEventListener('pointermove', onPointerMove, { passive: true })
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      root.removeEventListener('pointermove', onPointerMove)
      root.removeEventListener('scroll', onScroll)
    }
  }, [items.length])

  const fetchPage = useCallback(async (from: number, signal?: AbortSignal): Promise<ProjectsResponse> => {
    const params = new URLSearchParams(listParams)
    params.set('from', String(from))
    const response = await fetch(`/api/projects?${params}`, { signal })
    if (!response.ok) throw new Error(response.statusText)
    return response.json()
  }, [listParams])

  useEffect(() => {
    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    loadingMoreRef.current = false
    setLoading(true)
    setLoadingMore(false)
    setError(null)
    setItems([])
    setTotal(0)

    fetchPage(0, controller.signal)
      .then((data) => {
        if (requestId !== requestIdRef.current) return
        setItems(data.items ?? [])
        setTotal(data.total ?? 0)
      })
      .catch((e) => {
        if (e.name === 'AbortError') return
        if (requestId !== requestIdRef.current) return
        setError(e.message)
      })
      .finally(() => {
        if (requestId !== requestIdRef.current) return
        setLoading(false)
      })

    return () => controller.abort()
  }, [fetchPage])

  const errorRef = useRef<string | null>(null)
  errorRef.current = error

  const loadMore = useCallback((force = false) => {
    if (loading || loadingMoreRef.current) return
    if (errorRef.current && !force) return
    const from = itemsLengthRef.current
    if (from >= totalRef.current) return

    const requestId = requestIdRef.current
    loadingMoreRef.current = true
    setLoadingMore(true)
    setError(null)

    fetchPage(from)
      .then((data) => {
        if (requestId !== requestIdRef.current) return
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id))
          return [...prev, ...(data.items ?? []).filter((p) => !seen.has(p.id))]
        })
        setTotal(data.total ?? 0)
      })
      .catch((e) => {
        if (e.name === 'AbortError') return
        if (requestId !== requestIdRef.current) return
        setError(e.message)
      })
      .finally(() => {
        if (requestId !== requestIdRef.current) return
        loadingMoreRef.current = false
        setLoadingMore(false)
      })
  }, [fetchPage, loading])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || loading) return
    const root = sentinel.closest('.panel-content')
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { root, rootMargin: '160px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore, loading, items.length])

  return (
    <>
      <div className="panel-search">
        {cellBbox && onClearCellFilter && (
          <button type="button" className="panel-cell-filter-clear" onClick={onClearCellFilter}>
            Clear map filter
          </button>
        )}
        <input
          type="search"
          className="search-input"
          placeholder="Search programmes…"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange?.(e.target.value)}
          aria-label="Search programmes"
        />
      </div>
      {loading && <p className="list-message">Loading projects…</p>}
      {error && !items.length && <p className="list-message list-error">Error: {error}</p>}
      {!loading && !error && !items.length && (
        <p className="list-message">
          {debouncedSearchQuery ? `No programmes found for “${debouncedSearchQuery}”.` : 'No programmes found.'}
        </p>
      )}
      {items.length > 0 && (
        <>
          <ul ref={listRef} className="project-list">
            {items.map((p) => (
              <li
                key={p.id}
                className="project-item"
                data-project-id={p.id}
                onMouseEnter={() => handleItemMouseEnter(p.id)}
                onMouseLeave={() => handleItemMouseLeave(p.id)}
              >
                <button
                  type="button"
                  className="project-card-button"
                  onClick={() => onSelectProject?.(p.id)}
                >
                  <span className="project-link">{p.name}</span>
                  {p.description && (
                    <p className="project-desc">{p.description.slice(0, 120)}{p.description.length > 120 ? '…' : ''}</p>
                  )}
                  {(() => {
                    const grouped = p.eovs?.length ? groupEovsByTopLevel(p.eovs, resolveEov) : []
                    if (!grouped.length) return null
                    return (
                      <div className="project-eov-badges">
                        {grouped.map(({ key, label, bg }) => (
                          <span
                            key={key}
                            className="project-eov-bubble"
                            style={{ backgroundColor: bg }}
                            data-label={label}
                            aria-label={label}
                          />
                        ))}
                      </div>
                    )
                  })()}
                </button>
              </li>
            ))}
          </ul>
          {items.length < total && (
            <div ref={sentinelRef} className="list-sentinel">
              {loadingMore && <p className="list-message">Loading more…</p>}
              {error && (
                <p className="list-message list-error">
                  Error: {error}{' '}
                  <button type="button" className="list-retry" onClick={() => loadMore(true)}>
                    Retry
                  </button>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}
