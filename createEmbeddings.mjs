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

// Estrae comune, zona e tipo di contenuto
function extractMetadata(text, fileName) {
  // calendario raccolta
  let m = text.match(/Comune di ([\wÀ-ú\s]+)\s*-\s*Zona\s*([\wÀ-ú\s]+)/i);
  if (m) {
    return {
      comune: m[1].trim(),
      zona: m[2].trim(),
      tipo: "calendario",
      source: fileName,
    };
  }

  // isole ecologiche
  if (/Isole Ecologiche|Centro Comunale/i.test(text)) {
    // cerca nome comune esplicitamente
    let comuneMatch = text.match(/Catania|Messina|Palermo/i);
    return {
      comune: comuneMatch ? comuneMatch[0] : "Sconosciuto",
      tipo: "isola_ecologica",
      source: fileName,
    };
  }

  // fallback
  return { tipo: "altro", source: fileName };
}

for (const fileName of fileNames) {
  const document = await fsp.readFile(`${docs_dir}/${fileName}`, "utf8");
  console.log(`Vectorizing ${fileName}`);

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 700,
    chunkOverlap: 100,
    separators: ["\n## ", "\n### ", "\n---", "\n\n"],
  });
  
  const chunks = await splitter.createDocuments([document]);

  chunks.forEach(
    (c) => (c.metadata = extractMetadata(c.pageContent, fileName))
  );

  await MongoDBAtlasVectorSearch.fromDocuments(chunks, new OpenAIEmbeddings(), {
    //crea embedding per ogni chunk
    collection,
    indexName: "default",
    textKey: "text",
    embeddingKey: "embedding",
  });
}

await client.close();
console.log("Done");
