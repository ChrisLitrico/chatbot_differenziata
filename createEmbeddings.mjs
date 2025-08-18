import { promises as fsp } from "fs"; //file system operations
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter"; //divide il testo in chunks
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb"; // salva i vettori in mongoDB atlas
import { OpenAIEmbeddings } from "@langchain/openai"; // crea embeddings (usa il pacchetto @langchain)
import { MongoClient } from "mongodb"; //mongo databse
import "dotenv/config"; // variabili d'ambiente

const client = new MongoClient(process.env.MONGODB_ATLAS_URI || "");
await client.connect(); // connetti il client prima di ottenere la collection
const dbName = "docs";
const collectionName = "embeddings";
const collection = client.db(dbName).collection(collectionName);
//connette al docs database

const docs_dir = "_assets/gestione_rifiuti_docs";
const fileNames = await fsp.readdir(docs_dir); //legge i file nella cartella docs
console.log(fileNames);
for (const fileName of fileNames) {
  const document = await fsp.readFile(`${docs_dir}/${fileName}`, "utf8");
  console.log(`Vectorizing ${fileName}`);

  const splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
    chunkSize: 300, // Aumentato per catturare sezioni complete
    chunkOverlap: 50, // Più overlap per continuità
  });

  const output = await splitter.createDocuments([document]);

  await MongoDBAtlasVectorSearch.fromDocuments(
    //crea embedding per ogni chunk
    output,
    new OpenAIEmbeddings(),
    {
      collection,
      indexName: "default",
      textKey: "text",
      embeddingKey: "embedding",
    }
  );
}

console.log("Done: Closing Connection");
await client.close();
