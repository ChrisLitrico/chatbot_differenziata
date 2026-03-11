import { UIMessage } from 'ai'
import { formatRagContext, retrieveRelevantDocuments } from '@/app/lib/rag'

// streaming responses up to 60 seconds (Netlify supports up to 26s free, 900s pro)
export const maxDuration = 60

// Default: gpt-4o-mini (no web search, grounded on RAG context). Override with OPENAI_MODEL env var.
const MODEL_NAME = process.env.OPENAI_MODEL || 'gpt-4o-mini'

function extractMessageText(message: UIMessage | undefined): string {
  if (!message) return ''
  // AI SDK v5: parts array (preferred)
  if (Array.isArray(message.parts) && message.parts.length > 0) {
    return (message.parts as Array<{ type: string; text?: string }>)
      .map((part) => (part.type === 'text' && part.text ? part.text : ''))
      .join('\n')
      .trim()
  }
  // Fallback: content string (older SDK versions / raw fetch)
  if (typeof (message as unknown as { content?: string }).content === 'string') {
    return (message as unknown as { content: string }).content.trim()
  }
  return ''
}

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json()
    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: 'Invalid messages payload.' }, { status: 400 })
    }

    const lastMessage = messages[messages.length - 1]
    const currentMessageContent = extractMessageText(lastMessage)
    if (!currentMessageContent) {
      return Response.json({ error: 'Missing message content.' }, { status: 400 })
    }

    // RAG context
    let ragContext = 'Nessun documento rilevante recuperato.'
    try {
      const vectorSearchDocs = await retrieveRelevantDocuments(currentMessageContent)
      ragContext = formatRagContext(vectorSearchDocs)
    } catch (vectorError) {
      console.error('[Chat API] Vector search error:', vectorError)
    }

    const SYSTEM_TEMPLATE = `Sei un assistente per la raccolta differenziata in Sicilia.

COMUNI SUPPORTATI: Catania, Messina, Palermo, Ragusa, Siracusa, Trapani.

REGOLA ZERO — NESSUNA CONOSCENZA ESTERNA:
- La tua UNICA fonte di informazioni è il CONTESTO fornito in fondo a questo messaggio.
- NON usare MAI conoscenze proprie, dati memorizzati, o informazioni non presenti nel CONTESTO.
- Se un'informazione non è nel CONTESTO, non la conosci e non devi inventarla né dedurla.
- Questo vale anche per calendari di raccolta, orari, indirizzi, gestori e qualsiasi dato specifico.

AMBITO:
- Rispondi SOLO a domande riguardanti raccolta differenziata, riciclo, smaltimento rifiuti, isole ecologiche, calendari di raccolta e tematiche ambientali correlate in Sicilia.
- IMPORTANTE: qualsiasi domanda su dove buttare, come smaltire o in quale bidone mettere un oggetto o materiale (es. pelo di animali, giocattoli rotti, scontrini, pannolini, capsule caffè, ecc.) È una domanda sui rifiuti e DEVI rispondere.
- Per qualsiasi domanda VERAMENTE fuori tema (ricette, sport, politica, matematica, programmazione, ecc.), rispondi ESCLUSIVAMENTE con: "Mi dispiace, posso aiutarti solo con domande sulla raccolta differenziata e lo smaltimento dei rifiuti in Sicilia. Chiedimi pure qualcosa su questo tema! ♻️"
- NON rispondere MAI a domande non correlate ai rifiuti/riciclo, nemmeno parzialmente.

REGOLA FONDAMENTALE SUL CONTESTO:
- Il CONTESTO sotto contiene più documenti recuperati. Usa SOLO le parti direttamente pertinenti alla domanda dell'utente.
- IGNORA completamente le informazioni del contesto che non c'entrano con la domanda. Non menzionarle, nemmeno come nota o avvertenza.
- NON mischiare informazioni di documenti diversi se non sono correlati alla stessa domanda.

STILE:
- Rispondi in modo naturale e conciso, come parleresti a un amico
- Evita ripetizioni: non ripetere zona/comune se già chiari dal contesto
- Usa emoji per i tipi di rifiuto: 🌱 organico, 📦 carta, 🪣 plastica, 🫙 vetro, 🗑️ indifferenziato

FORMATO:
- Vai dritto al punto con le info essenziali
- Per calendari: "[Tipo] → [Giorno/i]" su righe separate
- Aggiungi dettagli utili (orario, contenitore) solo se rilevanti

FONTI E LINK:
- Alla fine della risposta, aggiungi UNA SOLA sezione "📎 Link utili:" con i link pertinenti dal contesto, formattati come link Markdown: [Nome](URL)
- NON inserire link nel corpo del testo: mettili SOLO nella sezione finale

SE IL CONTESTO NON CONTIENE DATI PERTINENTI:
- Se la domanda riguarda un comune non tra quelli supportati, o il CONTESTO non ha informazioni utili, rispondi ESATTAMENTE così (adattando il comune se rilevato): "Non ho dati per questa zona. Posso aiutarti per: **Catania, Messina, Palermo, Ragusa, Siracusa, Trapani**. Di quale comune hai bisogno?"
- NON fornire mai indicazioni generiche, stime o "di solito si fa così": se non è nel CONTESTO, non rispondere con dati inventati.
- NON suggerire siti web o contatti che non siano esplicitamente presenti nel CONTESTO.

CONTESTO:
${ragContext}`

    // Build messages for Perplexity (only user/assistant roles)
    const perplexityMessages = [
      { role: 'system' as const, content: SYSTEM_TEMPLATE },
      ...messages
        .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
        .map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: extractMessageText(msg),
        })),
    ]

    // Call OpenAI
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: MODEL_NAME, messages: perplexityMessages, stream: true }),
    })

    if (!openaiRes.ok) {
      const err = await openaiRes.text()
      throw new Error(`OpenAI error ${openaiRes.status}: ${err}`)
    }

    // Re-format Perplexity SSE into AI SDK v5 UIMessageStream protocol
    const messageId = crypto.randomUUID()
    const textPartId = crypto.randomUUID()

    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    const uiStream = new ReadableStream({
      async start(controller) {
        const emit = (obj: object) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        }

        // AI SDK v5 UIMessageStream protocol events
        emit({ type: 'start', messageId })
        emit({ type: 'text-start', id: textPartId })

        const reader = openaiRes.body?.getReader()
        if (!reader) {
          controller.close()
          return
        }

        let buffer = ''
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            // Accumulate in buffer to handle lines split across chunks
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            // Keep the last (potentially incomplete) line in the buffer
            buffer = lines.pop() ?? ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const data = line.slice(6).trim()
              if (data === '[DONE]') continue
              try {
                const parsed = JSON.parse(data)
                const delta: string = parsed.choices?.[0]?.delta?.content ?? ''
                if (delta) {
                  emit({ type: 'text-delta', id: textPartId, delta })
                }
              } catch {
                /* skip malformed lines */
              }
            }
          }
          // Flush any remaining buffer content
          if (buffer.startsWith('data: ')) {
            const data = buffer.slice(6).trim()
            if (data && data !== '[DONE]') {
              try {
                const parsed = JSON.parse(data)
                const delta: string = parsed.choices?.[0]?.delta?.content ?? ''
                if (delta) {
                  emit({ type: 'text-delta', id: textPartId, delta })
                }
              } catch {
                /* skip */
              }
            }
          }
        } finally {
          reader.releaseLock()
        }

        emit({ type: 'text-end', id: textPartId })
        emit({ type: 'finish' })
        controller.close()
      },
    })

    return new Response(uiStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('[Chat API] Error:', error instanceof Error ? error.message : error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
