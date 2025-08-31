// app/api/chat/route.ts
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export const runtime = "edge";
export const maxDuration = 30;

// Funzione helper per estrarre il testo dai messaggi usando parts
function extractMessageText(message: any): string {
  if (!Array.isArray(message.parts)) {
    console.warn(
      "Message parts non trovate, usando fallback content:",
      message
    );
    // Fallback per compatibilità
    return typeof message.content === "string" ? message.content : "";
  }

  return message.parts
    .filter((part: any) => part.type === "text")
    .map((part: any) => part.text)
    .join("");
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    if (!Array.isArray(messages)) {
      return new Response("Invalid messages array", { status: 400 });
    }

    // Estrai il contenuto dell'ultimo messaggio per la ricerca vettoriale
    const lastMessage = messages[messages.length - 1];
    const currentMessageContent = extractMessageText(lastMessage);

    if (!currentMessageContent.trim()) {
      return new Response(
        JSON.stringify({
          id: Date.now().toString(),
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "Mi dispiace, non ho ricevuto nessuna domanda. Puoi ripetere per favore?",
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Recupero del contesto da vector search
    let vectorSearch = {};
    try {
      const vectorResponse = await fetch(
        "http://localhost:3000/api/vectorSearch",
        {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: currentMessageContent,
        }
      );

      if (vectorResponse.ok) {
        vectorSearch = await vectorResponse.json();
      } else {
        console.warn("Vector search failed, proceeding without context");
      }
    } catch (vectorError) {
      console.error("Vector search error:", vectorError);
      // Procediamo senza contesto se la ricerca vettoriale fallisce
    }

    // Template con contesto RAG
    const TEMPLATE = `Sei un assistente esperto nella raccolta differenziata siciliana. Il tuo obiettivo è aiutare i cittadini a smaltire correttamente i rifiuti.

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
${JSON.stringify(vectorSearch)}

DOMANDA UTENTE: ${currentMessageContent}`;

    // Costruzione messaggi per LangChain
    const lcMessages = [
      new SystemMessage(
        "Tu sei un assistente per la raccolta differenziata in Sicilia."
      ),
      new HumanMessage(TEMPLATE),
    ];

    const model = new ChatOpenAI({
      model: "gpt-5-nano",
    });

    const responseMessage = await model.invoke(lcMessages);
    const responseText =
      typeof responseMessage.content === "string"
        ? responseMessage.content
        : JSON.stringify(responseMessage.content);

    // Restituisci la risposta nel formato atteso da useChat con parts
    return new Response(
      JSON.stringify({
        id: Date.now().toString(),
        role: "assistant",
        parts: [
          {
            type: "text",
            text: responseText,
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error in chat route:", error);

    return new Response(
      JSON.stringify({
        id: Date.now().toString(),
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "Mi dispiace, si è verificato un errore. Riprova tra un momento.",
          },
        ],
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
}
