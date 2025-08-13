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
      return Response.json({
        id: Date.now().toString(),
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "Mi dispiace, non ho ricevuto nessuna domanda. Puoi ripetere per favore?",
          },
        ],
      });
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
    const TEMPLATE = `Sei un amichevole rappresentante della gestione dei rifiuti in Sicilia che ama aiutare le persone a gettare i rifiuti in modo corretto! 
Possiedi le informazioni sulla raccolta differenziata, rispondi alle domande utilizzando solo quelle informazioni, restituite in formato markdown. 
Se non sei sicuro di una risposta che non è presente esplicitamente nei documenti, rispondi: 
"Perdonami, non so come aiutarti con questa situazione. Prova a contattare il comune di riferimento per maggiori informazioni."

Context sections:
${JSON.stringify(vectorSearch)}

Question:
${currentMessageContent}`;

    // Costruzione messaggi per LangChain
    const lcMessages = [
      new SystemMessage(
        "Tu sei un assistente per la raccolta differenziata in Sicilia."
      ),
      new HumanMessage(TEMPLATE),
    ];

    const model = new ChatOpenAI({
      model: "gpt-5-nano"
    });

    const responseMessage = await model.invoke(lcMessages);
    const responseText =
      typeof responseMessage.content === "string"
        ? responseMessage.content
        : JSON.stringify(responseMessage.content);

    // Restituisci la risposta nel formato atteso da useChat con parts
    return Response.json({
      id: Date.now().toString(),
      role: "assistant",
      parts: [
        {
          type: "text",
          text: responseText,
        },
      ],
    });
  } catch (error) {
    console.error("Error in chat route:", error);

    return Response.json(
      {
        id: Date.now().toString(),
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "Mi dispiace, si è verificato un errore. Riprova tra un momento.",
          },
        ],
      },
      { status: 500 }
    );
  }
}
