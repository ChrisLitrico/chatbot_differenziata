import { openai } from "@ai-sdk/openai";
import { streamText, UIMessage, convertToModelMessages } from "ai";

// streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();

    // Ultimo messaggio dell'utente
    const lastMessage = messages[messages.length - 1];
    const currentMessageContent = lastMessage.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("\n");

    // Chiamata al tuo endpoint di vector search
    let vectorSearch = {};
    
    try {
      const vectorResponse = await fetch(
        process.env.NODE_ENV === 'development' 
          ? "http://localhost:3000/api/vectorSearch"
          : "https://chatbot-differenziata.netlify.app",
        {
          method: "POST",
          headers: {
            "Content-Type": "text/plain", // Cambiato da application/json
          },
          body: currentMessageContent, // Inviato come plain text
        }
      );

      if (vectorResponse.ok) {
        vectorSearch = await vectorResponse.json();
      } else {
        console.warn('Vector search failed:', vectorResponse.status);
      }
    } catch (vectorError) {
      console.error('Vector search error:', vectorError);
      // Continua senza contesto se fallisce
    }

    // Prompt template con contesto
    const SYSTEM_TEMPLATE = `Sei un assistente esperto nella raccolta differenziata siciliana. Il tuo obiettivo è aiutare i cittadini a smaltire correttamente i rifiuti.

ISTRUZIONI OPERATIVE:
- Rispondi SOLO usando le informazioni fornite nei documenti
- Usa emoji appropriate per rendere le risposte più chiare (🍕 per umido o organico, 📦 per carta e cartone, 🪣 per plastica, 🫙 per vetro, 🗑️ per indifferenziato)
- Specifica sempre la zona quando fornisci calendari di raccolta
- Includi quando disponibile le modalità di conferimento (colore contenitore, tipo sacco)

FORMATO RISPOSTA:
- Per calendari: specifica zona, gestore e giorni
- Per classificazione rifiuti: indica categoria, contenitore e esempi pratici

SE NON SAI LA RISPOSTA:
"Mi dispiace, non ho informazioni specifiche su questo argomento nei miei documenti. Ti consiglio di contattare direttamente:
- Il gestore della raccolta della tua zona
- Il comune di riferimento
[Includi link disponibili se presenti nel contesto]"

CONTESTO DISPONIBILE:
${JSON.stringify(vectorSearch)}`;

    // Stream verso gpt-5-nano (mantiene la cronologia e aggiunge il contesto come system prompt)
    const result = streamText({
      model: openai("gpt-5-nano"),
      system: SYSTEM_TEMPLATE,
      messages: convertToModelMessages(messages),
    });

    return result.toUIMessageStreamResponse();
    
  } catch (error) {
    console.error('Chat API error:', error);
    
    // Ritorna una risposta di errore
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: 'Si è verificato un errore. Riprova tra un momento.' 
      }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}