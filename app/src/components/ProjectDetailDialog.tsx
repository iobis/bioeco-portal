import { useEffect, useState } from 'react'

export interface ProjectDetail {
  id?: string
  name: string
  description?: string
  url?: string
  uri?: string
  start_year?: number
  end_year?: number
  eovs?: Array<{ code?: string; label?: string; name?: string; uri?: string }>
  identifiers?: Array<{
    url?: string
    value?: string
    description?: string
    property_id?: string
  }>
  contacts?: Array<{ name?: string; email?: string; url?: string; contact_type?: string }>
  services?: Array<{ name?: string; url?: string }>
  readiness_data?: string
  readiness_requirements?: string
  readiness_coordination?: string
}

export interface ObisProgrammeFilter {
  name: string
  tags: string[]
}

interface ProjectDetailDialogProps {
  projectId: string | null
  onClose: () => void
  onShowObisData?: (filter: ObisProgrammeFilter) => void
}

function identifierHref(ident: { url?: string; value?: string }): string | undefined {
  const url = ident.url?.trim()
  if (url) return url
  const value = ident.value?.trim()
  if (value && /^https?:\/\//i.test(value)) return value
  return undefined
}

function identifierLabel(ident: { url?: string; value?: string }): string {
  return identifierHref(ident) || ident.value?.trim() || 'Identifier'
}

const OBIS_DATASET_API = 'https://api.obis.org/dataset'
const OBIS_DATASET_PAGE = 'https://obis.org/dataset'
const OBIS_DATASET_LIMIT = 10

interface ObisDatasetHit {
  id: string
  title?: string
  records?: number
  archive?: string
  abstract?: string
}

interface ObisDatasetList {
  total: number
  results: ObisDatasetHit[]
}

/** HTTP(S) identifier values OBIS can match as dataset tags. */
export function identifierTags(project: ProjectDetail): string[] {
  const tags: string[] = []
  const seen = new Set<string>()
  const add = (value?: string) => {
    const tag = value?.trim()
    if (!tag || !/^https?:\/\//i.test(tag) || seen.has(tag)) return
    seen.add(tag)
    tags.push(tag)
  }
  for (const ident of project.identifiers ?? []) {
    add(ident.url)
    add(ident.value)
  }
  return tags
}

function formatRecords(n: number | undefined): string | null {
  if (n == null || Number.isNaN(n)) return null
  return n.toLocaleString()
}

function archiveHref(value: string | undefined): string | undefined {
  const url = value?.trim()
  if (!url || !/^https?:\/\//i.test(url)) return undefined
  return url
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function programmeObisFilter(project: ProjectDetail): ObisProgrammeFilter | null {
  const tags: string[] = []
  const seen = new Set<string>()
  const add = (value?: string) => {
    const tag = value?.trim()
    if (!tag || seen.has(tag)) return
    seen.add(tag)
    tags.push(tag)
  }
  for (const ident of project.identifiers ?? []) {
    add(ident.url)
    const value = ident.value?.trim()
    if (value && /^https?:\/\//i.test(value)) add(value)
  }
  add(project.id)
  if (!tags.length || !project.name?.trim()) return null
  return { name: project.name.trim(), tags }
}

export function ProjectDetailDialog({ projectId, onClose, onShowObisData }: ProjectDetailDialogProps) {
  const projectApiUrl = projectId ? `/api/projects/${projectId}?include_geometry=false` : null
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [datasets, setDatasets] = useState<ObisDatasetList | null>(null)
  const [datasetsLoading, setDatasetsLoading] = useState(false)
  const [datasetsError, setDatasetsError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) {
      setProject(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    fetch(`/api/projects/${projectId}?include_geometry=false`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Project not found' : r.statusText)
        return r.json()
      })
      .then(setProject)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [projectId])

  const tagsKey = project ? identifierTags(project).join('\n') : ''

  useEffect(() => {
    if (!tagsKey) {
      setDatasets(null)
      setDatasetsError(null)
      setDatasetsLoading(false)
      return
    }

    const controller = new AbortController()
    setDatasetsLoading(true)
    setDatasetsError(null)
    setDatasets(null)

    const params = new URLSearchParams()
    params.set('tags', tagsKey.split('\n').join(','))
    params.set('size', String(OBIS_DATASET_LIMIT))

    fetch(`${OBIS_DATASET_API}?${params}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText || `HTTP ${r.status}`)
        return r.json()
      })
      .then((json: ObisDatasetList) => {
        setDatasets({
          total: json.total ?? 0,
          results: Array.isArray(json.results) ? json.results.slice(0, OBIS_DATASET_LIMIT) : [],
        })
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setDatasetsError(e instanceof Error ? e.message : 'Failed to load OBIS datasets')
        setDatasets(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) setDatasetsLoading(false)
      })

    return () => controller.abort()
  }, [tagsKey])

  if (projectId == null) return null

  const obisFilter = project ? programmeObisFilter(project) : null
  const hasIdentifierTags = Boolean(tagsKey)

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="dialog-backdrop" onClick={handleBackdropClick} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="dialog-box">
        <header className="dialog-header">
          <h2 id="dialog-title" className="dialog-title">Programme details</h2>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="dialog-body">
          {loading && <p className="dialog-message">Loading…</p>}
          {error && <p className="dialog-message dialog-error">{error}</p>}
          {project && !loading && (
            <>
              <h3 className="dialog-project-name">{project.name}</h3>
              {project.url && (
                <a
                  href={project.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dialog-website-link"
                >
                  <svg
                    className="dialog-website-icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  website
                </a>
              )}
              {project.description && (
                <p className="dialog-description">{project.description}</p>
              )}
              {(project.start_year != null || project.end_year != null) && (
                <p className="dialog-meta">
                  <span className="dialog-meta-label">Period</span>{' '}
                  {project.start_year ?? '?'} – {project.end_year ?? '?'}
                </p>
              )}
              {project.identifiers?.length ? (
                <div className="dialog-section">
                  <span className="dialog-meta-label">Identifiers</span>
                  <ul className="dialog-eov-list">
                    {project.identifiers.map((ident, i) => {
                      const href = identifierHref(ident)
                      const label = identifierLabel(ident)
                      return (
                        <li key={i}>
                          {href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="dialog-link dialog-identifier-link">
                              {label}
                            </a>
                          ) : (
                            label
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ) : null}
              {(project.readiness_data || project.readiness_requirements || project.readiness_coordination) && (
                <div className="dialog-section">
                  <span className="dialog-meta-label">Readiness levels</span>
                  <div className="dialog-readiness" aria-label="Readiness levels">
                    {project.readiness_data && (
                      <div className="dialog-readiness-row">
                        <span className="dialog-readiness-label">Data</span>
                        <span className="dialog-readiness-value">{project.readiness_data}</span>
                      </div>
                    )}
                    {project.readiness_requirements && (
                      <div className="dialog-readiness-row">
                        <span className="dialog-readiness-label">Requirements</span>
                        <span className="dialog-readiness-value">{project.readiness_requirements}</span>
                      </div>
                    )}
                    {project.readiness_coordination && (
                      <div className="dialog-readiness-row">
                        <span className="dialog-readiness-label">Coordination</span>
                        <span className="dialog-readiness-value">{project.readiness_coordination}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {project.eovs?.length ? (
                <div className="dialog-section">
                  <span className="dialog-meta-label">EOVs</span>
                  <ul className="dialog-eov-list">
                    {project.eovs.map((eov, i) => (
                      <li key={i}>{eov.label ?? eov.code ?? eov.uri ?? '—'}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {project.contacts?.length ? (
                <div className="dialog-section">
                  <span className="dialog-meta-label">Contacts</span>
                  <ul className="dialog-eov-list">
                    {project.contacts.map((c, i) => {
                      const parts: string[] = []
                      if (c.name) parts.push(c.name)
                      return (
                        <li key={i}>
                          {parts.join(' – ')}
                          {c.email && (
                            <>
                              {' – '}
                              <a href={`mailto:${c.email}`} className="dialog-link dialog-link-muted">
                                {c.email}
                              </a>
                            </>
                          )}
                          {c.url && (
                            <>
                              {' – '}
                              <a href={c.url} target="_blank" rel="noopener noreferrer" className="dialog-link dialog-link-muted">
                                Link
                              </a>
                            </>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ) : null}
              {project.services?.length ? (
                <div className="dialog-section">
                  <span className="dialog-meta-label">Services</span>
                  <ul className="dialog-eov-list">
                    {project.services.map((s, i) => (
                      <li key={i}>
                        {s.name && <>{s.name}{s.url && ' – '}</>}
                        {s.url && (
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="dialog-link dialog-link-muted">
                            {s.url}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {hasIdentifierTags && (
                <div className="dialog-section">
                  <div className="dialog-section-head">
                    <span className="dialog-meta-label">OBIS datasets</span>
                    {onShowObisData && obisFilter && (
                      <button
                        type="button"
                        className="dialog-obis-view-btn"
                        onClick={() => {
                          onShowObisData(obisFilter)
                          onClose()
                        }}
                      >
                        View OBIS data
                      </button>
                    )}
                  </div>
                  {datasetsLoading && <p className="dialog-message">Loading OBIS datasets…</p>}
                  {datasetsError && <p className="dialog-message dialog-error">{datasetsError}</p>}
                  {!datasetsLoading && !datasetsError && datasets && (
                    <p className="dialog-message dialog-list-summary">
                      {datasets.total === 0
                        ? 'No OBIS datasets found for these identifiers.'
                        : `${datasets.total.toLocaleString()} dataset${datasets.total === 1 ? '' : 's'}${
                            datasets.results.length < datasets.total
                              ? ` (showing ${datasets.results.length})`
                              : ''
                          }`}
                    </p>
                  )}
                  {!datasetsLoading && !datasetsError && datasets?.results.length ? (
                    <ul className="dialog-dataset-list">
                      {datasets.results.map((d) => {
                        const records = formatRecords(d.records)
                        const archive = archiveHref(d.archive)
                        const blurb = d.abstract ? stripHtml(d.abstract) : ''
                        return (
                          <li key={d.id} className="dialog-dataset-item">
                            <a
                              className="dialog-dataset-link"
                              href={`${OBIS_DATASET_PAGE}/${d.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <span className="dialog-dataset-title">{d.title?.trim() || d.id}</span>
                            </a>
                            {records || archive ? (
                              <div className="dialog-dataset-meta-row">
                                {records ? (
                                  <span className="dialog-dataset-meta">{records} records in OBIS</span>
                                ) : null}
                                {archive ? (
                                  <a
                                    className="dialog-archive-pill"
                                    href={archive}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    Download
                                  </a>
                                ) : null}
                              </div>
                            ) : null}
                            {blurb ? (
                              <a
                                className="dialog-dataset-link dialog-dataset-extra"
                                href={`${OBIS_DATASET_PAGE}/${d.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <span className="dialog-dataset-blurb">
                                  {blurb.slice(0, 140)}
                                  {blurb.length > 140 ? '…' : ''}
                                </span>
                              </a>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                </div>
              )}
              <p className="dialog-actions">
                <a href={projectApiUrl ?? '#'} target="_blank" rel="noopener noreferrer" className="dialog-link dialog-link-muted">
                  API record
                </a>
                {project.uri && (
                  <a href={project.uri} target="_blank" rel="noopener noreferrer" className="dialog-link dialog-link-muted">
                    JSON-LD
                  </a>
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
