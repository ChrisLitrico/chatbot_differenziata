import { createOpenAI } from '@ai-sdk/openai'
import { streamText, UIMessage } from 'ai'
import { formatRagContext, retrieveRelevantDocuments } from '@/app/lib/rag'

// streaming responses up to 60 seconds (Netlify supports up to 26s free, 900s pro)
export const maxDuration = 60

// Default: sonar (cheap, fast). Override with PERPLEXITY_MODEL env var if needed.
const MODEL_NAME = process.env.PERPLEXITY_MODEL || 'sonar'

// Initialize Perplexity via OpenAI-compatible provider
// .chat() forces /chat/completions endpoint (Perplexity doesn't support /responses)
const perplexityProvider = createOpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY,
  baseURL: 'https://api.perplexity.ai',
})

function extractMessageText(message: UIMessage | undefined): string {
  if (!message || !Array.isArray(message.parts)) {
    return ''
  }

  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
    .trim()
}

export async function POST(req: Request) {
  try {
    console.log('[Chat API] Starting request...')
    console.log('[Chat API] MODEL_NAME:', MODEL_NAME)
    console.log('[Chat API] PERPLEXITY_API_KEY exists:', !!process.env.PERPLEXITY_API_KEY)

    const { messages }: { messages: UIMessage[] } = await req.json()
    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: 'Invalid messages payload.' }, { status: 400 })
    }

    // Ultimo messaggio dell'utente
    const lastMessage = messages[messages.length - 1]
    const currentMessageContent = extractMessageText(lastMessage)
    if (!currentMessageContent) {
      return Response.json(
        {
          error: 'Missing message content.',
          message: 'Mi dispiace, non ho ricevuto una domanda valida. Puoi riprovare?',
        },
        { status: 400 },
      )
    }

    // Chiamata al tuo endpoint di vector search
    let ragContext = 'Nessun documento rilevante recuperato.'

    try {
      console.log('[Chat API] Retrieving documents...')
      const startTime = Date.now()
      const vectorSearchDocs = await retrieveRelevantDocuments(currentMessageContent)
      console.log('[Chat API] Documents retrieved in', Date.now() - startTime, 'ms, found:', vectorSearchDocs.length)
      ragContext = formatRagContext(vectorSearchDocs)
    } catch (vectorError) {
      console.error('[Chat API] Vector search error:', vectorError)
      // Continua senza contesto se fallisce
    }

    // Prompt template con contesto
    const SYSTEM_TEMPLATE = `Sei un assistente amichevole per la raccolta differenziata in Sicilia.

STILE:
- Rispondi in modo naturale e conciso, come parleresti a un amico
- Evita ripetizioni: non ripetere zona/comune se già chiari dal contesto
- Usa emoji per i tipi di rifiuto: 🍕 organico, 📦 carta, 🪣 plastica, 🫙 vetro, 🗑️ indifferenziato

FORMATO:
- Vai dritto al punto con le info essenziali
- Per calendari: "[Tipo] → [Giorno/i]" su righe separate
- Aggiungi dettagli utili (orario, contenitore) solo se rilevanti
- Link utili alla fine, se disponibili

SE NON HAI INFO SPECIFICHE NEL CONTESTO:
- Prova comunque a rispondere usando le tue conoscenze generali sulla raccolta differenziata
- Indica chiaramente che si tratta di indicazioni generali e non specifiche per il comune dell'utente
- Suggerisci di verificare con il gestore locale o il comune per conferma
- Solo se non puoi aiutare in nessun modo: "Non ho questa informazione. Contatta il gestore della tua zona o il comune."

CONTESTO:
${ragContext}`

    // Map messages to Perplexity-compatible format
    // Convert UIMessage array to simple { role, content } that Perplexity accepts
    const perplexityMessages: Array<{ role: 'user' | 'assistant'; content: string }> = messages
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: extractMessageText(msg),
      }))

    console.log('[Chat API] Starting stream with model:', MODEL_NAME)
    const result = streamText({
      model: perplexityProvider.chat(MODEL_NAME),
      system: SYSTEM_TEMPLATE,
      messages: perplexityMessages,
    })
    console.log('[Chat API] Stream started, returning response')

    return result.toUIMessageStreamResponse()
  } catch (error) {
    console.error('[Chat API] Fatal error:', error)
    console.error('[Chat API] Error type:', error instanceof Error ? error.constructor.name : typeof error)
    console.error('[Chat API] Error message:', error instanceof Error ? error.message : String(error))

    // Ritorna una risposta di errore
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: 'Si è verificato un errore. Riprova tra un momento.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}
