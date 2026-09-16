import { useEffect, useMemo, useState } from 'react'
import { buildEovResolver, eovTagUrls, type EovVocabulary } from '../eovVocabulary'

const OBIS_DATASET_API = 'https://api.obis.org/dataset'
const OBIS_DATASET_PAGE = 'https://obis.org/dataset'

interface ObisDataset {
  id: string
  title?: string
  records?: number
  url?: string
  abstract?: string
  tags?: string[]
}

interface DatasetListResponse {
  total: number
  results: ObisDataset[]
}

interface DatasetDialogProps {
  cellBbox: string | null
  onClose: () => void
  eovCategories?: string[]
  eovVocabulary?: EovVocabulary | null
}

function bboxStringToWkt(bbox: string): string | null {
  const parts = bbox.split(',').map((p) => parseFloat(p.trim()))
  if (parts.length !== 4 || parts.some(Number.isNaN)) return null
  const [minLon, minLat, maxLon, maxLat] = parts
  return `POLYGON((${minLon} ${minLat},${maxLon} ${minLat},${maxLon} ${maxLat},${minLon} ${maxLat},${minLon} ${minLat}))`
}

function formatRecords(n: number | undefined): string | null {
  if (n == null || Number.isNaN(n)) return null
  return n.toLocaleString()
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function eovsFromTags(
  tags: string[] | undefined,
  resolve: (uri: string) => { code: string; label: string; badge: { bg: string; fg: string } } | null,
): Array<{ key: string; label: string; bg: string }> {
  if (!tags?.length) return []
  const byKey = new Map<string, { label: string; bg: string }>()
  for (const tag of tags) {
    const resolved = resolve(typeof tag === 'string' ? tag : String(tag))
    if (!resolved || byKey.has(resolved.code)) continue
    byKey.set(resolved.code, { label: resolved.label, bg: resolved.badge.bg })
  }
  return [...byKey.entries()].map(([key, { label, bg }]) => ({ key, label, bg }))
}

export function DatasetDialog({
  cellBbox,
  onClose,
  eovCategories = [],
  eovVocabulary = null,
}: DatasetDialogProps) {
  const [data, setData] = useState<DatasetListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resolveEov = useMemo(() => buildEovResolver(eovVocabulary), [eovVocabulary])

  useEffect(() => {
    if (!cellBbox?.trim()) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }

    const geometry = bboxStringToWkt(cellBbox)
    if (!geometry) {
      setData(null)
      setError('Invalid cell bounds.')
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    const params = new URLSearchParams()
    params.set('geometry', geometry)
    params.set('size', '100')
    const tags = eovTagUrls(eovVocabulary, eovCategories)
    if (!tags.length) {
      setData(null)
      setError(eovVocabulary ? 'No EOV tags available.' : 'EOV vocabulary still loading…')
      setLoading(false)
      return
    }
    params.set('tags', tags.join(','))

    fetch(`${OBIS_DATASET_API}?${params}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText || `HTTP ${r.status}`)
        return r.json()
      })
      .then((json: DatasetListResponse) => {
        setData({
          total: json.total ?? 0,
          results: Array.isArray(json.results) ? json.results : [],
        })
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Failed to load datasets')
        setData(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [cellBbox, eovCategories, eovVocabulary])

  if (cellBbox == null) return null

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="dialog-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dataset-dialog-title"
    >
      <div className="dialog-box dialog-box--datasets">
        <header className="dialog-header">
          <h2 id="dataset-dialog-title" className="dialog-title">
            OBIS datasets
          </h2>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="dialog-body">
          {loading && <p className="dialog-message">Loading datasets…</p>}
          {error && <p className="dialog-message dialog-error">{error}</p>}
          {!loading && !error && data && (
            <p className="dialog-message dialog-list-summary">
              {data.total === 0
                ? 'No OBIS datasets found for this cell.'
                : `${data.total.toLocaleString()} dataset${data.total === 1 ? '' : 's'}${
                    data.results.length < data.total ? ` (showing ${data.results.length})` : ''
                  }`}
            </p>
          )}
          {!loading && !error && data?.results?.length ? (
            <ul className="dialog-dataset-list">
              {data.results.map((d) => {
                const href = `${OBIS_DATASET_PAGE}/${d.id}`
                const records = formatRecords(d.records)
                const blurb = d.abstract ? stripHtml(d.abstract) : ''
                const eovs = eovsFromTags(d.tags, resolveEov)
                return (
                  <li key={d.id} className="dialog-dataset-item">
                    <a
                      className="dialog-dataset-link"
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="dialog-dataset-title">{d.title?.trim() || d.id}</span>
                      {records ? (
                        <span className="dialog-dataset-meta">{records} records in OBIS</span>
                      ) : null}
                      {blurb ? (
                        <span className="dialog-dataset-blurb">
                          {blurb.slice(0, 140)}
                          {blurb.length > 140 ? '…' : ''}
                        </span>
                      ) : null}
                      {eovs.length ? (
                        <div className="project-eov-badges dialog-dataset-eovs">
                          {eovs.map(({ key, label, bg }) => (
                            <span key={key} className="dialog-dataset-eov" title={label}>
                              <span
                                className="project-eov-bubble"
                                style={{ backgroundColor: bg }}
                                aria-hidden
                              />
                              <span className="dialog-dataset-eov-label">{label}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </a>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  )
}
