/** Types and helpers for the EOV vocabulary (from API). */

export interface EovBadge {
  bg: string
  fg: string
}

export interface TopLevelEov {
  url: string
  code: string
  label: string
  badge?: EovBadge
  alt_uris?: string[]
}

export interface Subvariable {
  url: string
  code: string
  label: string
  parent_code: string
  alt_uris?: string[]
}

export interface EovVocabulary {
  version?: string
  top_level_eovs: TopLevelEov[]
  subvariables: Subvariable[]
}

const FALLBACK_PALETTE: EovBadge[] = [
  { bg: '#38bdf8', fg: '#fff' },
  { bg: '#fb7185', fg: '#fff' },
  { bg: '#a78bfa', fg: '#fff' },
  { bg: '#4ade80', fg: '#fff' },
  { bg: '#22d3ee', fg: '#fff' },
  { bg: '#a3e635', fg: '#1a1a1a' },
  { bg: '#2dd4bf', fg: '#fff' },
  { bg: '#e879f9', fg: '#fff' },
]

/** Build a map: URI -> { code, label, badge } for top-level resolution (for display). */
export function buildEovResolver(vocab: EovVocabulary | null): (uri: string) => { code: string; label: string; badge: EovBadge } | null {
  if (!vocab?.top_level_eovs?.length) return () => null

  const byCode = new Map<string, TopLevelEov>()
  for (const t of vocab.top_level_eovs) {
    byCode.set(t.code, t)
  }

  const uriMap = new Map<string, { code: string; label: string; badge: EovBadge }>()
  for (const t of vocab.top_level_eovs) {
    const entry = { code: t.code, label: t.label, badge: t.badge ?? FALLBACK_PALETTE[0] }
    const url = t.url?.trim()
    if (url) uriMap.set(url, entry)
    for (const alt of t.alt_uris ?? []) {
      if (alt?.trim()) uriMap.set(alt.trim(), entry)
    }
  }
  for (const s of vocab.subvariables ?? []) {
    const parent = byCode.get(s.parent_code)
    const entry = parent
      ? { code: parent.code, label: parent.label, badge: parent.badge ?? FALLBACK_PALETTE[0] }
      : { code: s.parent_code, label: s.parent_code, badge: FALLBACK_PALETTE[0] }
    const url = s.url?.trim()
    if (url) uriMap.set(url, entry)
    for (const alt of s.alt_uris ?? []) {
      if (alt?.trim()) uriMap.set(alt.trim(), entry)
    }
  }

  const sortedUrls = [...uriMap.keys()].sort((a, b) => b.length - a.length)

  return (uri: string) => {
    if (!uri?.trim()) return null
    const u = uri.trim()
    if (uriMap.has(u)) return uriMap.get(u)! as { code: string; label: string; badge: EovBadge }
    for (const candidate of sortedUrls) {
      if (u.startsWith(candidate + '/') || u.startsWith(candidate.replace(/\/$/, '') + '/')) {
        return uriMap.get(candidate)! as { code: string; label: string; badge: EovBadge }
      }
    }
    return null
  }
}

export function getFallbackBadge(index: number): EovBadge {
  return FALLBACK_PALETTE[index % FALLBACK_PALETTE.length]
}

/** Path segments after `/eov/` (empty if URI is not a goosocean-style EOV URL). */
function eovPathSegments(uri: string): string[] | null {
  const marker = '/eov/'
  const idx = uri.indexOf(marker)
  if (idx < 0) return null
  const rest = uri.slice(idx + marker.length).replace(/\/+$/, '')
  if (!rest) return null
  return rest.split('/').filter(Boolean)
}

/**
 * Split programme EOV entries into top-level EOVs vs subvariables.
 *
 * Prefer vocabulary exact matches when available; otherwise use URI path depth
 * (`/eov/{slug}` vs `/eov/{slug}/…`), which covers subvariables missing from the
 * vocab file (e.g. phytoplankton/abundance).
 */
export function partitionEovs<T extends { uri?: string; code?: string; label?: string }>(
  eovs: T[],
  vocab: EovVocabulary | null = null,
): { topLevel: T[]; subvariables: T[] } {
  const topUrls = new Set<string>()
  const subUrls = new Set<string>()
  if (vocab) {
    for (const t of vocab.top_level_eovs ?? []) {
      if (t.url?.trim()) topUrls.add(t.url.trim())
      for (const alt of t.alt_uris ?? []) {
        if (alt?.trim()) topUrls.add(alt.trim())
      }
    }
    for (const s of vocab.subvariables ?? []) {
      if (s.url?.trim()) subUrls.add(s.url.trim())
      for (const alt of s.alt_uris ?? []) {
        if (alt?.trim()) subUrls.add(alt.trim())
      }
    }
  }

  const topLevel: T[] = []
  const subvariables: T[] = []
  const seen = new Set<string>()

  for (const eov of eovs) {
    const uri = (eov.uri ?? '').trim()
    const key = uri || `${eov.code ?? ''}|${eov.label ?? ''}`
    if (!key || seen.has(key)) continue
    seen.add(key)

    if (uri && subUrls.has(uri)) {
      subvariables.push(eov)
      continue
    }
    if (uri && topUrls.has(uri)) {
      topLevel.push(eov)
      continue
    }
    if (uri && [...topUrls].some((top) => uri.startsWith(top.replace(/\/+$/, '') + '/'))) {
      subvariables.push(eov)
      continue
    }

    const segments = uri ? eovPathSegments(uri) : null
    if (segments && segments.length >= 2) {
      subvariables.push(eov)
    } else {
      topLevel.push(eov)
    }
  }

  return { topLevel, subvariables }
}

/** Resolve EOV codes to canonical URLs for OBIS `tags=` filters.
 *  Empty selection → all top-level EOVs (BioEco scope by default).
 */
export function eovTagUrls(vocab: EovVocabulary | null, codes: string[]): string[] {
  if (!vocab?.top_level_eovs?.length) return []
  const selected = codes.length
    ? codes
    : vocab.top_level_eovs.map((e) => e.code)
  const byCode = Object.fromEntries(vocab.top_level_eovs.map((e) => [e.code, e]))
  const urls: string[] = []
  for (const code of selected) {
    const url = byCode[code]?.url?.trim()
    if (url) urls.push(url)
  }
  return urls
}
