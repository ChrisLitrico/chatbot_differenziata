import { UIMessage } from 'ai'
import { formatRagContext, retrieveRelevantDocuments } from '@/app/lib/rag'

// streaming responses up to 60 seconds (Netlify supports up to 26s free, 900s pro)
export const maxDuration = 60

// Default: sonar (cheap, fast). Override with PERPLEXITY_MODEL env var if needed.
const MODEL_NAME = process.env.PERPLEXITY_MODEL || 'sonar'

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

    const SYSTEM_TEMPLATE = `Sei un assistente amichevole per la raccolta differenziata in Sicilia.

AMBITO:
- Rispondi SOLO a domande riguardanti raccolta differenziata, riciclo, smaltimento rifiuti, isole ecologiche, calendari di raccolta e tematiche ambientali correlate in Sicilia.
- Per qualsiasi domanda fuori tema (ricette, sport, politica, matematica, programmazione, ecc.), rispondi ESCLUSIVAMENTE con: "Mi dispiace, posso aiutarti solo con domande sulla raccolta differenziata e lo smaltimento dei rifiuti in Sicilia. Chiedimi pure qualcosa su questo tema! ♻️"
- NON rispondere MAI a domande non correlate ai rifiuti/riciclo, nemmeno parzialmente.

REGOLA FONDAMENTALE SUL CONTESTO:
- Il CONTESTO sotto contiene più documenti recuperati. Usa SOLO le parti direttamente pertinenti alla domanda dell'utente.
- IGNORA completamente le informazioni del contesto che non c'entrano con la domanda. Non menzionarle, nemmeno come nota o avvertenza.
- NON mischiare informazioni di documenti diversi se non sono correlati alla stessa domanda.

STILE:
- Rispondi in modo naturale e conciso, come parleresti a un amico
- Evita ripetizioni: non ripetere zona/comune se già chiari dal contesto
- Usa emoji per i tipi di rifiuto: � organico, 📦 carta, 🪣 plastica, 🫙 vetro, 🗑️ indifferenziato

FORMATO:
- Vai dritto al punto con le info essenziali
- Per calendari: "[Tipo] → [Giorno/i]" su righe separate
- Aggiungi dettagli utili (orario, contenitore) solo se rilevanti

FONTI E LINK:
- Alla fine della risposta, aggiungi UNA SOLA sezione "📎 Link utili:" con i link pertinenti dal contesto, formattati come link Markdown: [Nome](URL)
- NON inserire link nel corpo del testo: mettili SOLO nella sezione finale
- Se l'utente chiede info che non hai, suggerisci il sito ufficiale del comune se presente nel contesto

SE NON HAI INFO SPECIFICHE NEL CONTESTO:
- Se la domanda è pertinente ai rifiuti ma non hai dati specifici, fornisci indicazioni generali specificando che sono generiche
- Suggerisci di consultare il sito ufficiale del gestore o di contattarli direttamente se hai il link
- Solo se non puoi aiutare: "Non ho questa informazione. Contatta il gestore della tua zona."

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

    // Call Perplexity
    const perplexityRes = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({ model: MODEL_NAME, messages: perplexityMessages, stream: true }),
    })

    if (!perplexityRes.ok) {
      const err = await perplexityRes.text()
      throw new Error(`Perplexity error ${perplexityRes.status}: ${err}`)
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

        const reader = perplexityRes.body?.getReader()
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
                let delta: string = parsed.choices?.[0]?.delta?.content ?? ''
                if (delta) {
                  // Strip Perplexity citation markers like [1], [5][8], etc.
                  delta = delta.replace(/\[\d+\]/g, '')
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
                let delta: string = parsed.choices?.[0]?.delta?.content ?? ''
                if (delta) {
                  delta = delta.replace(/\[\d+\]/g, '')
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
