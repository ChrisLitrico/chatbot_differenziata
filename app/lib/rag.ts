import { OpenAIEmbeddings } from '@langchain/openai'
import { getMongoClient } from '@/app/lib/mongodb'

type RetrievedDoc = {
  pageContent: string
  metadata: Record<string, unknown>
  score?: number
}

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small'
const DB_NAME = 'docs'
const COLLECTION_NAME = 'embeddings'
const INDEX_NAME = process.env.MONGODB_VECTOR_INDEX || 'embeddings_index'
const VECTOR_PATH = process.env.MONGODB_VECTOR_PATH || 'embedding'
const MAX_RESULTS = Number(process.env.RAG_RESULTS || 4)
const FETCH_RESULTS = Math.max(12, MAX_RESULTS * 3)

let _embeddingsModel: OpenAIEmbeddings | null = null
function getEmbeddingsModel(): OpenAIEmbeddings {
  if (!_embeddingsModel) {
    _embeddingsModel = new OpenAIEmbeddings({
      modelName: EMBEDDING_MODEL,
      stripNewLines: true,
    })
  }
  return _embeddingsModel
}

const CITY_ALIASES: Record<string, string[]> = {
  Palermo: ['palermo'],
  Catania: ['catania'],
  Messina: ['messina'],
  Siracusa: ['siracusa', 'syracuse'],
  Ragusa: ['ragusa'],
}

const ZONE_ALIASES: Record<string, string[]> = {
  Nord: ['nord', 'north', 'settentrionale'],
  Centro: ['centro', 'central', 'centrale'],
  Sud: ['sud', 'south', 'meridionale'],
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

function detectComuneFromQuery(query: string): string | null {
  const normalizedQuery = normalize(query)
  for (const [comune, aliases] of Object.entries(CITY_ALIASES)) {
    if (aliases.some((alias) => normalizedQuery.includes(alias))) {
      return comune
    }
  }
  return null
}

function detectZonaFromQuery(query: string): string | null {
  const normalizedQuery = normalize(query)
  for (const [zona, aliases] of Object.entries(ZONE_ALIASES)) {
    if (aliases.some((alias) => normalizedQuery.includes(alias))) {
      return zona
    }
  }
  return null
}

function getDocComune(doc: RetrievedDoc): string {
  const value = doc.metadata.comune
  return typeof value === 'string' ? value : ''
}

function getDocZona(doc: RetrievedDoc): string {
  const value = doc.metadata.zona
  return typeof value === 'string' ? value : ''
}

function prioritizeComune(docs: RetrievedDoc[], comune: string): RetrievedDoc[] {
  const normalizedComune = normalize(comune)
  const matching = docs.filter((doc) => normalize(getDocComune(doc)) === normalizedComune)
  const nonMatching = docs.filter((doc) => normalize(getDocComune(doc)) !== normalizedComune)
  return [...matching, ...nonMatching]
}

function prioritizeZona(docs: RetrievedDoc[], zona: string): RetrievedDoc[] {
  const normalizedZona = normalize(zona)
  // Prioritizza documenti che contengono la zona nel metadata o nel contenuto
  const matching = docs.filter((doc) => {
    const docZona = normalize(getDocZona(doc))
    const content = normalize(doc.pageContent)
    return docZona.includes(normalizedZona) || content.includes(normalizedZona)
  })
  const nonMatching = docs.filter((doc) => {
    const docZona = normalize(getDocZona(doc))
    const content = normalize(doc.pageContent)
    return !docZona.includes(normalizedZona) && !content.includes(normalizedZona)
  })
  return [...matching, ...nonMatching]
}

function dedupeDocuments(docs: RetrievedDoc[]): RetrievedDoc[] {
  const seen = new Set<string>()
  const deduped: RetrievedDoc[] = []

  for (const doc of docs) {
    const source = typeof doc.metadata?.source === 'string' ? doc.metadata.source : ''
    const key = `${source}::${doc.pageContent}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(doc)
  }

  return deduped
}

async function getCollection() {
  const client = await getMongoClient()
  return client.db(DB_NAME).collection(COLLECTION_NAME)
}

function toRetrievedDoc(record: Record<string, unknown>): RetrievedDoc {
  const rawMetadata = record.metadata && typeof record.metadata === 'object' ? (record.metadata as Record<string, unknown>) : {}

  const metadata: Record<string, unknown> = {
    ...rawMetadata,
    comune: rawMetadata.comune ?? (typeof record.comune === 'string' ? record.comune : undefined),
    tipo: rawMetadata.tipo ?? (typeof record.tipo === 'string' ? record.tipo : undefined),
    source: rawMetadata.source ?? (typeof record.source === 'string' ? record.source : undefined),
    zona: rawMetadata.zona ?? (typeof record.zona === 'string' ? record.zona : undefined),
  }

  return {
    pageContent: typeof record.text === 'string' ? record.text : '',
    metadata,
    score: typeof record.score === 'number' ? record.score : undefined,
  }
}

async function vectorSearch(query: string): Promise<RetrievedDoc[]> {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return []
  }

  console.log('[RAG] Connecting to MongoDB...')
  const collection = await getCollection()

  const limit = FETCH_RESULTS

  // 1. Genera embedding
  let queryEmbedding: number[]
  try {
    queryEmbedding = await getEmbeddingsModel().embedQuery(normalizedQuery)
  } catch (embeddingError) {
    console.error('[RAG] embedding generation failed:', embeddingError)
    return await textFallbackSearch(normalizedQuery)
  }

  // 2. Vector search (no filter — filter fields not in index, we post-filter)
  try {
    const vectorStage: Record<string, unknown> = {
      index: INDEX_NAME,
      path: VECTOR_PATH,
      queryVector: queryEmbedding,
      limit,
      numCandidates: Math.max(50, limit * 10),
    }

    const pipeline = [
      { $vectorSearch: vectorStage },
      {
        $set: {
          score: { $meta: 'vectorSearchScore' },
        },
      },
      {
        $project: {
          _id: 0,
          text: 1,
          metadata: 1,
          comune: 1,
          tipo: 1,
          source: 1,
          zona: 1,
          score: 1,
        },
      },
    ]

    const docs = (await collection.aggregate(pipeline).toArray()) as Record<string, unknown>[]

    const result = docs.map(toRetrievedDoc).filter((doc) => doc.pageContent)
    if (result.length > 0) {
      return result
    }
  } catch (error) {
    console.error(`[RAG] vectorSearch failed (index="${INDEX_NAME}", path="${VECTOR_PATH}"):`, error)
  }

  // Fallback testuale se vector search non trova nulla
  return await textFallbackSearch(normalizedQuery)
}

// Fallback: ricerca testuale quando vector search non restituisce risultati
async function textFallbackSearch(query: string): Promise<RetrievedDoc[]> {
  const collection = await getCollection()

  // Estrai keyword significative (ignora stop words italiane comuni)
  const stopWords = new Set([
    'il',
    'lo',
    'la',
    'i',
    'gli',
    'le',
    'un',
    'una',
    'uno',
    'di',
    'da',
    'in',
    'su',
    'per',
    'con',
    'tra',
    'fra',
    'a',
    'e',
    'o',
    'ma',
    'che',
    'non',
    'mi',
    'ti',
    'si',
    'ci',
    'vi',
    'ne',
    'me',
    'te',
    'se',
    'ce',
    've',
    'come',
    'dove',
    'quando',
    'cosa',
    'quale',
    'quanto',
    'chi',
    'cui',
    'questo',
    'quello',
    'suo',
    'loro',
    'mio',
    'tuo',
    'nostro',
    'vostro',
    'sapresti',
    'dire',
    'puoi',
    'dirmi',
    'vorrei',
    'sapere',
    'ciao',
    'buongiorno',
    'grazie',
  ])
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w))
    .slice(0, 4) // Limita a 4 keyword per velocità

  if (keywords.length === 0) {
    return []
  }

  // Usa una singola regex combinata per cercare testualmente
  const combinedPattern = keywords.join('|')
  const textQuery: Record<string, unknown> = {
    text: { $regex: combinedPattern, $options: 'i' },
  }

  try {
    const docs = (await collection.find(textQuery).limit(FETCH_RESULTS).toArray()) as Record<string, unknown>[]

    return docs.map(toRetrievedDoc).filter((doc) => doc.pageContent)
  } catch (error) {
    console.error('[RAG] textFallback failed:', error)
    return []
  }
}

export async function retrieveRelevantDocuments(query: string): Promise<RetrievedDoc[]> {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return []
  }

  try {
    const targetComune = detectComuneFromQuery(normalizedQuery)
    const targetZona = detectZonaFromQuery(normalizedQuery)

    // Vector search senza filtri (il vector index non ha filter fields)
    // Post-filtriamo per comune/zona sui risultati
    const baseDocs = await vectorSearch(normalizedQuery)

    if (!targetComune && !targetZona) {
      return dedupeDocuments(baseDocs).slice(0, MAX_RESULTS)
    }

    let prioritizedDocs = baseDocs

    // Prioritizza per comune se rilevato (post-filtering)
    if (targetComune) {
      prioritizedDocs = prioritizeComune(prioritizedDocs, targetComune)
    }

    // Poi prioritizza per zona se rilevata
    if (targetZona) {
      prioritizedDocs = prioritizeZona(prioritizedDocs, targetZona)
    }

    const result = dedupeDocuments(prioritizedDocs).slice(0, MAX_RESULTS)
    return result
  } catch (error) {
    console.error('[RAG] retrieveRelevantDocuments error:', error)
    return []
  }
}

function metadataValue(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function compactText(text: string, maxLength = 600): string {
  const compacted = text.replace(/\s+/g, ' ').trim()
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength)}...` : compacted
}

export function formatRagContext(docs: RetrievedDoc[]): string {
  if (!docs.length) {
    return 'Nessun documento disponibile.'
  }

  return docs
    .slice(0, MAX_RESULTS)
    .map((doc, index) => {
      const comune = metadataValue(doc.metadata, 'comune')
      const zona = metadataValue(doc.metadata, 'zona')
      const fonte = metadataValue(doc.metadata, 'fonte')
      const gestore = metadataValue(doc.metadata, 'gestore')
      const paginaGestore = metadataValue(doc.metadata, 'pagina_contatti_gestore')

      const location = [comune, zona].filter(Boolean).join(' - ') || 'N/D'
      const content = compactText(doc.pageContent)

      const sourceLines: string[] = []
      if (fonte) sourceLines.push(`Fonte ufficiale: ${fonte}`)
      if (gestore && paginaGestore) {
        sourceLines.push(`Gestore (${gestore}): ${paginaGestore}`)
      } else if (paginaGestore) {
        sourceLines.push(`Contatti gestore: ${paginaGestore}`)
      }

      const sourcePart = sourceLines.length ? `\n${sourceLines.join('\n')}` : ''
      return `[${index + 1}] ${location}\n${content}${sourcePart}`
    })
    .join('\n\n')
}
