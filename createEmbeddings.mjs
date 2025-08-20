import { promises as fsp } from "fs"; //file system operations
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter"; //divide il testo in chunks
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb"; // salva i vettori in mongoDB atlas
import { OpenAIEmbeddings } from "@langchain/openai"; // crea embeddings (usa il pacchetto @langchain)
import { MongoClient } from "mongodb"; //mongo databse
import "dotenv/config"; // variabili d'ambiente

const client = new MongoClient(process.env.MONGODB_ATLAS_URI || "");
await client.connect(); // connetti il client prima di ottenere la collection
const collection = client.db("docs").collection("embeddings");
//connette al docs database

const docs_dir = "_assets/gestione_rifiuti_docs";
const fileNames = await fsp.readdir(docs_dir);

function extractMetadata(text, fileName) {
  const normalizedFile = fileName.toLowerCase();

  // 1. DETERMINA IL COMUNE DAL FILENAME (fonte di verità principale)
  let comune = "Sconosciuto";
  if (normalizedFile.includes("catania")) {
    comune = "Catania";
  } else if (normalizedFile.includes("messina")) {
    comune = "Messina";
  } else if (normalizedFile.includes("palermo")) {
    comune = "Palermo";
  }

  // 2. GESTIONE CALENDARI RACCOLTA
  let calendarMatch = text.match(
    /Comune\s+di\s+([\wÀ-ú\s]+)\s*[-–]\s*Zona\s*([\wÀ-ú\s]+)/i
  );
  if (calendarMatch) {
    return {
      comune: calendarMatch[1].trim(),
      zona: calendarMatch[2].trim(),
      tipo: "calendario",
      source: fileName,
    };
  }

  // 3. DETERMINA IL TIPO DI CONTENUTO
  let tipo = "altro";

  // Isole ecologiche - pattern più specifici
  if (
    /Isole\s+ecologiche|Lista\s+isole\s+ecologiche|Centro\s+Comunale/i.test(
      text
    )
  ) {
    tipo = "isola_ecologica";
  }
  // calendario rifiuti
  else if (
    /Calendario\s+raccolta|Quando\s+conferire|presso\s+le\s+raccolta\s+differenziata/i.test(
      text
    )
  ) {
    tipo = "calendario_rifiuti";
  }
  // Rifiuti ammessi
  else if (
    /Rifiuti\s+ammessi|Cosa\s+conferire|presso\s+le\s+isole\s+ecologiche/i.test(
      text
    )
  ) {
    tipo = "rifiuti_ammessi";
  }
  // Orari e informazioni operative
  else if (/Orari?\s+apertura|Orari?\s+servizio/i.test(text)) {
    tipo = "orari";
  }

  // 4. LOG PER DEBUGGING
  console.log(`  📄 ${fileName} -> 🏢 ${comune} | 📋 ${tipo}`);

  return {
    comune: comune,
    tipo: tipo,
    source: fileName,
  };
}

// === FUNZIONE DI VALIDAZIONE ===
function validateAndLogMetadata(chunks, fileName) {
  const metadata = chunks.map((c) => c.metadata);
  const comuni = [...new Set(metadata.map((m) => m.comune))];
  const tipi = [...new Set(metadata.map((m) => m.tipo))];

  console.log(`  ✅ File processato: ${chunks.length} chunks`);
  console.log(`     Comuni: ${comuni.join(", ")}`);
  console.log(`     Tipi: ${tipi.join(", ")}`);

  // Controllo di coerenza: tutti i chunk dello stesso file dovrebbero avere lo stesso comune
  if (comuni.length > 1) {
    console.warn(
      `  ⚠️  ATTENZIONE: ${fileName} ha chunk con comuni diversi: ${comuni.join(
        ", "
      )}`
    );
  }

  return metadata;
}

// === PROCESSING PRINCIPALE ===
console.log(`🚀 Inizio elaborazione di ${fileNames.length} files...\n`);

for (const fileName of fileNames) {
  const document = await fsp.readFile(`${docs_dir}/${fileName}`, "utf8");
  console.log(`📊 Vectorizing ${fileName}`);

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 700,
    chunkOverlap: 100,
    separators: ["\n## ", "\n### ", "\n---", "\n\n"],
  });

  const chunks = await splitter.createDocuments([document]);

  // Applica metadata a tutti i chunks
  chunks.forEach((c) => {
    c.metadata = extractMetadata(c.pageContent, fileName);
  });

  // Validazione e logging
  validateAndLogMetadata(chunks, fileName);

  // Salva nel database
  await MongoDBAtlasVectorSearch.fromDocuments(chunks, new OpenAIEmbeddings(), {
    collection,
    indexName: "default",
    textKey: "text",
    embeddingKey: "embedding",
  });

  console.log(`  ✨ Salvati ${chunks.length} chunks per ${fileName}\n`);
}

// === REPORT FINALE ===
console.log("🎯 Generazione report finale...");

// Verifica la distribuzione nel database
const allDocs = await collection.find({}).toArray();
const reportByComune = {};
const reportByTipo = {};

allDocs.forEach((doc) => {
  const comune = doc.metadata?.comune || "Sconosciuto";
  const tipo = doc.metadata?.tipo || "sconosciuto";

  reportByComune[comune] = (reportByComune[comune] || 0) + 1;
  reportByTipo[tipo] = (reportByTipo[tipo] || 0) + 1;
});

console.log("\n📊 REPORT FINALE:");
console.log("=".repeat(50));
console.log("📍 Distribuzione per COMUNE:");
Object.entries(reportByComune).forEach(([comune, count]) => {
  console.log(`   ${comune}: ${count} chunks`);
});

console.log("\n📋 Distribuzione per TIPO:");
Object.entries(reportByTipo).forEach(([tipo, count]) => {
  console.log(`   ${tipo}: ${count} chunks`);
});

console.log("\n" + "=".repeat(50));

await client.close();
console.log("✅ Done - Embedding completato con successo!");
