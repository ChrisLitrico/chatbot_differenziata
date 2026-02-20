import { openai } from '@ai-sdk/openai'
import { streamText, UIMessage, convertToModelMessages } from 'ai'
import { formatRagContext, retrieveRelevantDocuments } from '@/app/lib/rag'

// streaming responses up to 30 seconds
export const maxDuration = 30

const MODEL_NAME = process.env.OPENAI_MODEL || 'gpt-4-mini'

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
      const vectorSearchDocs = await retrieveRelevantDocuments(currentMessageContent)
      ragContext = formatRagContext(vectorSearchDocs)
    } catch (vectorError) {
      console.error('Vector search error:', vectorError)
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

    // Stream verso il modello configurato (mantiene la cronologia e aggiunge il contesto come system prompt)
    const result = streamText({
      model: openai(MODEL_NAME),
      system: SYSTEM_TEMPLATE,
      messages: convertToModelMessages(messages),
    })

    return result.toUIMessageStreamResponse()
  } catch (error) {
    console.error('Chat API error:', error)

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
