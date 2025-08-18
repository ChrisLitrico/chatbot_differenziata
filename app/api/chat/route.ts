import { openai } from "@ai-sdk/openai";
import { streamText, UIMessage, convertToModelMessages } from "ai";

// streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Ultimo messaggio dell’utente
  const lastMessage = messages[messages.length - 1];
  const currentMessageContent = lastMessage.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n");

  // Chiamata al tuo endpoint di vector search
  const vectorSearch = await fetch("http://localhost:3000/api/vectorSearch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: currentMessageContent,
  }).then((res) => res.json());

  // Prompt template con contesto
  const SYSTEM_TEMPLATE = `Sei un amichevole rappresentante della gestione dei rifiuti in Sicilia che ama aiutare le persone a gettare i rifiuti in modo corretto! 
Possiedi le informazioni sulla raccolta differenziata, rispondi alle domande utilizzando solo quelle informazioni con emoji che aiutano a comprendere meglio le informazioni. 
Se non sei sicuro di una risposta che non è presente esplicitamente nei documenti, rispondi: 
"Perdonami, non so come aiutarti con questa situazione. Prova a contattare il comune di riferimento per maggiori informazioni. 
Allegando anche i link utili del comune per cui cerca informazioni"

Context sections:
${JSON.stringify(vectorSearch)}

Question:
${currentMessageContent}`;

  // Stream verso gpt-5-nano (mantiene la cronologia e aggiunge il contesto come system prompt)
  const result = streamText({
    model: openai("gpt-5-nano"),
    system: SYSTEM_TEMPLATE,
    messages: convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
