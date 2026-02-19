import { retrieveRelevantDocuments } from '@/app/lib/rag'

// Limita a 20 richieste per IP ogni 60 secondi (in-memory, si resetta al restart)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT
}

async function extractQuery(req: Request): Promise<string> {
  const contentType = req.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => null)
    if (body && typeof body.query === 'string') {
      return body.query.trim()
    }
    return ''
  }

  return (await req.text()).trim()
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (isRateLimited(ip)) {
    return Response.json({ error: 'Too many requests. Riprova tra un minuto.' }, { status: 429 })
  }

  try {
    const query = await extractQuery(req)

    if (!query) {
      return Response.json({ error: 'Invalid or missing query.' }, { status: 400 })
    }

    const docs = await retrieveRelevantDocuments(query)
    return Response.json(docs, { status: 200 })
  } catch (error) {
    console.error('Error in vectorSearch route:', error)
    return Response.json(
      { error: 'Internal Server Error' },
      {
        status: 500,
      },
    )
  }
}
