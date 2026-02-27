import { promises as fsp } from "fs"; //file system operations
import { OpenAIEmbeddings } from "@langchain/openai"; // crea embeddings (usa il pacchetto @langchain)
import { MongoClient } from "mongodb"; //mongo databse
import { config as loadDotEnv } from "dotenv";

// Carica variabili come fa Next.js: prima .env.local, poi .env
loadDotEnv({ path: ".env.local" });
loadDotEnv({ path: ".env" });

const CONNECT_RETRIES = Number(process.env.MONGODB_CONNECT_RETRIES || 8);
const CONNECT_RETRY_MS = Number(process.env.MONGODB_CONNECT_RETRY_MS || 5000);
const SERVER_SELECTION_TIMEOUT_MS = Number(
  process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 15000
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractHostFromMongoUri(uri) {
  const match = uri.match(/@([^/?]+)/);
  return match ? match[1] : "host-sconosciuto";
}

function resolveMongoUri() {
  const uri = process.env.MONGODB_ATLAS_URI?.trim();
  if (!uri) {
    throw new Error(
      "MONGODB_ATLAS_URI mancante. Aggiungi la variabile in .env.local o .env."
    );
  }
  return uri;
}

function isSrvDnsError(error) {
  return (
    error?.code === "ENOTFOUND" &&
    typeof error?.hostname === "string" &&
    error.hostname.startsWith("_mongodb._tcp.")
  );
}

function isClusterWarmupError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("server selection timed out") ||
    message.includes("replicasetnoprimary") ||
    message.includes("no suitable servers found") ||
    message.includes("connection <monitor>") ||
    message.includes("paused")
  );
}

function isAuthError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("bad auth") ||
    message.includes("authentication failed") ||
    message.includes("auth failed")
  );
}

function formatMongoConnectionError(error, uri) {
  const host = extractHostFromMongoUri(uri);
  if (isSrvDnsError(error)) {
    return new Error(
      [
        `Connessione MongoDB fallita: DNS SRV non risolto per ${host}.`,
        "Verifica questi punti:",
        "1) Copia di nuovo la connection string da MongoDB Atlas (Connect > Drivers).",
        "2) Controlla che il cluster esista e sia attivo.",
        "3) Se la tua rete blocca DNS SRV, imposta MONGODB_ATLAS_URI_DIRECT con URI mongodb:// non-SRV.",
      ].join("\n")
    );
  }

  if (isClusterWarmupError(error)) {
    return new Error(
      [
        `Connessione MongoDB fallita: il cluster ${host} potrebbe essere ancora in riattivazione.`,
        "Attendi 1-2 minuti dopo l'unpause e riprova.",
        `Puoi aumentare i retry con MONGODB_CONNECT_RETRIES (attuale: ${CONNECT_RETRIES}).`,
        `Dettaglio errore: ${error?.message || "errore sconosciuto"}`,
      ].join("\n")
    );
  }

  if (isAuthError(error)) {
    return new Error(
      [
        `Connessione MongoDB fallita (${host}): autenticazione non valida.`,
        "Verifica questi punti in Atlas:",
        "1) Database Access: username/password corretti e utente attivo.",
        "2) Ruoli utente: almeno readWrite sul database 'docs'.",
        "3) URI in .env: aggiorna la password e codificala con encodeURIComponent se contiene caratteri speciali.",
        "4) Nessuno spazio o apice extra nel valore MONGODB_ATLAS_URI.",
      ].join("\n")
    );
  }

  const reason = error?.message || "errore sconosciuto";
  return new Error(`Connessione MongoDB fallita (${host}): ${reason}`);
}

async function connectWithRetry(uri, label) {
  let lastError;

  for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt++) {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    });

    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.close().catch(() => {});

      if (!isClusterWarmupError(error) || attempt === CONNECT_RETRIES) {
        throw error;
      }

      console.warn(
        `⚠️ MongoDB ${label}: tentativo ${attempt}/${CONNECT_RETRIES} fallito. Riprovo tra ${
          CONNECT_RETRY_MS / 1000
        }s...`
      );
      await sleep(CONNECT_RETRY_MS);
    }
  }

  throw lastError;
}

async function connectMongo() {
  const primaryUri = resolveMongoUri();
  const directUri = process.env.MONGODB_ATLAS_URI_DIRECT?.trim();

  try {
    const client = await connectWithRetry(primaryUri, "SRV");
    return { client, activeUri: primaryUri };
  } catch (error) {
    if (isSrvDnsError(error) && directUri) {
      console.warn(
        "⚠️ DNS SRV non disponibile. Tentativo con MONGODB_ATLAS_URI_DIRECT..."
      );
      const directClient = await connectWithRetry(directUri, "direct");
      return { client: directClient, activeUri: directUri };
    }
    throw formatMongoConnectionError(error, primaryUri);
  }
}

/**
 * Pre-parse a YAML file to extract top-level `fonte` URL and per-zone
 * gestore / pagina_contatti_gestore URLs.
 * Returns { fonte: string|null, gestori: { [zonaName]: { gestore, url } } }
 */
function extractFileUrls(content) {
  const urls = { fonte: null, gestori: {} };

  // Top-level fonte
  const fonteMatch = content.match(/^fonte:\s*"?([^"\n]+?)"?\s*$/m);
  if (fonteMatch) {
    urls.fonte = fonteMatch[1].trim();
  }

  // Per-zone gestore + pagina_contatti_gestore
  // Split on each zone entry ("  - zona:") to isolate zone blocks
  const zoneBlocks = content.split(/\n\s*-\s*zona:/);
  for (let i = 1; i < zoneBlocks.length; i++) {
    const block = zoneBlocks[i];
    // First non-empty line after the split is the zone name
    const zonaNameMatch = block.match(/^\s*"?([^"\n]+?)"?\s*$/m);
    const gestoreMatch = block.match(/\bgestore:\s*"?([^"\n]+?)"?\s*$/m);
    const urlMatch = block.match(/pagina_contatti_gestore:\s*"?([^"\n]+?)"?\s*$/m);

    if (zonaNameMatch) {
      const zonaName = zonaNameMatch[1].trim();
      urls.gestori[zonaName] = {
        gestore: gestoreMatch ? gestoreMatch[1].trim() : null,
        pagina_contatti_gestore: urlMatch ? urlMatch[1].trim() : null,
      };
    }
  }

  return urls;
}

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
  } else if (normalizedFile.includes("ragusa")) {
    comune = "Ragusa";
  } else if (normalizedFile.includes("siracusa")) {
    comune = "Siracusa";
  } else if (normalizedFile.includes("trapani")) {
    comune = "Trapani";
  } else if (normalizedFile.includes("agrigento")) {
    comune = "Agrigento";
  }

  // 2. ESTRAI LA ZONA DAL CONTENUTO DEL CHUNK
  let zona = null;
  
  // Pattern per zone nei calendari: "### Zona Catania Centro" o "Zona Catania Nord"
  const zonaMatch = text.match(/Zona\s+(?:\w+\s+)?(Nord|Centro|Sud)/i);
  if (zonaMatch) {
    zona = zonaMatch[1].charAt(0).toUpperCase() + zonaMatch[1].slice(1).toLowerCase();
  }
  
  // Pattern alternativo: "Catania Nord", "Catania Centro", "Catania Sud"
  if (!zona) {
    const zonaAltMatch = text.match(/(?:Catania|Messina|Palermo|Ragusa|Siracusa|Trapani|Agrigento)\s+(Nord|Centro|Sud)/i);
    if (zonaAltMatch) {
      zona = zonaAltMatch[1].charAt(0).toUpperCase() + zonaAltMatch[1].slice(1).toLowerCase();
    }
  }

  // 3. GESTIONE CALENDARI RACCOLTA
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

  // 4. DETERMINA IL TIPO DI CONTENUTO
  let tipo = "altro";

  // Isole ecologiche - pattern più specifici
  if (
    /Isole\s+ecologiche|Lista\s+isole\s+ecologiche|Centro\s+Comunale/i.test(
      text
    )
  ) {
    tipo = "isola_ecologica";
  }
  // calendario rifiuti - pattern migliorati per catturare schedules
  else if (
    /Calendario\s+raccolta|Quando\s+conferire|raccolta\s+per\s+zona|Umido.*:|Plastica.*:|Carta.*:|Vetro.*:|Indifferenziato.*:/i.test(
      text
    )
  ) {
    tipo = "calendario_rifiuti";
  }
  // Dettagli rifiuti ammessi/rifiutati
  else if (
    /Rifiuti\s+ammessi|Cosa\s+conferire|✅\s+|❌\s+|Dettagli\s+per\s+tipologia/i.test(
      text
    )
  ) {
    tipo = "rifiuti_ammessi";
  }
  // Orari e informazioni operative
  else if (/Orari?\s+apertura|Orari?\s+servizio|orari_conferimento/i.test(text)) {
    tipo = "orari";
  }

  // 5. LOG PER DEBUGGING
  const zonaLog = zona ? ` | 📍 ${zona}` : "";
  console.log(`  📄 ${fileName} -> 🏢 ${comune}${zonaLog} | 📋 ${tipo}`);

  const result = {
    comune: comune,
    tipo: tipo,
    source: fileName,
  };
  
  if (zona) {
    result.zona = zona;
  }
  
  return result;
}

// === FUNZIONE DI VALIDAZIONE ===
function validateAndLogMetadata(chunks, fileName) {
  const metadata = chunks.map((c) => c.metadata);
  const comuni = [...new Set(metadata.map((m) => m.comune))];
  const tipi = [...new Set(metadata.map((m) => m.tipo))];
  const zone = [...new Set(metadata.map((m) => m.zona).filter(Boolean))];

  console.log(`  ✅ File processato: ${chunks.length} chunks`);
  console.log(`     Comuni: ${comuni.join(", ")}`);
  if (zone.length > 0) {
    console.log(`     Zone: ${zone.join(", ")}`);
  }
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

function splitIntoChunks(text, options = {}) {
  const chunkSize = options.chunkSize ?? 700;
  const chunkOverlap = options.chunkOverlap ?? 100;
  const separators = options.separators ?? ["\n## ", "\n### ", "\n---", "\n\n"];
  const normalized = text.replace(/\r\n/g, "\n");

  const sections = separators.reduce(
    (acc, sep) => acc.flatMap((part) => part.split(sep)),
    [normalized]
  );

  const chunks = [];
  let buffer = "";

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) {
      continue;
    }

    const candidate = buffer ? `${buffer}\n\n${trimmed}` : trimmed;
    if (candidate.length <= chunkSize) {
      buffer = candidate;
      continue;
    }

    if (buffer) {
      chunks.push(buffer);
      const overlapStart = Math.max(0, buffer.length - chunkOverlap);
      buffer = `${buffer.slice(overlapStart)}\n\n${trimmed}`;
    } else {
      buffer = trimmed;
    }

    while (buffer.length > chunkSize) {
      chunks.push(buffer.slice(0, chunkSize));
      buffer = buffer.slice(Math.max(0, chunkSize - chunkOverlap));
    }
  }

  if (buffer.trim()) {
    chunks.push(buffer.trim());
  }

  return chunks.map((pageContent) => ({ pageContent, metadata: {} }));
}

async function main() {
  const { client, activeUri } = await connectMongo();
  const collection = client.db("docs").collection("embeddings");
  const embeddingsModel = new OpenAIEmbeddings({
    modelName: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
  });
  const docs_dir = "data/gestione_rifiuti_docs";
  const fileNames = await fsp.readdir(docs_dir);

  console.log(`🔌 MongoDB connesso: ${extractHostFromMongoUri(activeUri)}`);
  console.log(`🚀 Inizio elaborazione di ${fileNames.length} files...\n`);

  try {
    for (const fileName of fileNames) {
      const document = await fsp.readFile(`${docs_dir}/${fileName}`, "utf8");
      console.log(`📊 Vectorizing ${fileName}`);

      const chunks = splitIntoChunks(document, {
        chunkSize: 700,
        chunkOverlap: 100,
        separators: ["\n## ", "\n### ", "\n---", "\n\n"],
      });

      // Pre-parse URLs from YAML files
      const isYaml = fileName.endsWith(".yaml") || fileName.endsWith(".yml");
      const fileUrls = isYaml ? extractFileUrls(document) : { fonte: null, gestori: {} };

      // For .md files, try to extract inline URLs as fallback
      if (!isYaml) {
        const mdFonteMatch = document.match(/\]\((https?:\/\/[^)]+)\)/);
        if (mdFonteMatch) {
          fileUrls.fonte = mdFonteMatch[1].trim();
        }
      }

      // Applica metadata a tutti i chunks
      chunks.forEach((c) => {
        c.metadata = extractMetadata(c.pageContent, fileName);
      });

      // Inject URL metadata from the file-level parse
      chunks.forEach((c) => {
        if (fileUrls.fonte) {
          c.metadata.fonte = fileUrls.fonte;
        }

        // Match zona to the correct gestore URL
        const chunkZona = c.metadata.zona;
        if (chunkZona && Object.keys(fileUrls.gestori).length > 0) {
          // Try to find a matching zone (e.g. chunk zona "Nord" matches "Catania Nord")
          const matchingKey = Object.keys(fileUrls.gestori).find((k) =>
            k.toLowerCase().includes(chunkZona.toLowerCase())
          );
          if (matchingKey) {
            const g = fileUrls.gestori[matchingKey];
            if (g.gestore) c.metadata.gestore = g.gestore;
            if (g.pagina_contatti_gestore) c.metadata.pagina_contatti_gestore = g.pagina_contatti_gestore;
          }
        }

        // If no zona-specific URL found but there's only one gestore, use that
        if (!c.metadata.pagina_contatti_gestore) {
          const allGestori = Object.values(fileUrls.gestori).filter((g) => g.pagina_contatti_gestore);
          if (allGestori.length === 1) {
            c.metadata.gestore = allGestori[0].gestore;
            c.metadata.pagina_contatti_gestore = allGestori[0].pagina_contatti_gestore;
          }
        }
      });

      // Validazione e logging
      validateAndLogMetadata(chunks, fileName);

      // Evita duplicati: se il file è già stato indicizzato rimuovi i vecchi chunk
      const deleteResult = await collection.deleteMany({
        "metadata.source": fileName,
      });
      if (deleteResult.deletedCount > 0) {
        console.log(
          `  🧹 Rimossi ${deleteResult.deletedCount} vecchi chunks di ${fileName}`
        );
      }

      // Salva nel database senza dipendere da @langchain/mongodb
      const texts = chunks.map((chunk) => chunk.pageContent);
      const vectors = await embeddingsModel.embedDocuments(texts);
      if (vectors.length !== chunks.length) {
        throw new Error(
          `Embedding mismatch: attesi ${chunks.length}, ottenuti ${vectors.length} vettori`
        );
      }

      const docsToInsert = chunks.map((chunk, idx) => {
        const metadata = chunk.metadata || {};
        const embedding = vectors[idx];
        return {
          text: chunk.pageContent,
          embedding,
          docs: { embedding },
          metadata,
          ...metadata,
        };
      });
      await collection.insertMany(docsToInsert, { ordered: false });

      console.log(`  ✨ Salvati ${chunks.length} chunks per ${fileName}\n`);
    }

    // === REPORT FINALE ===
    console.log("🎯 Generazione report finale...");

    // Verifica la distribuzione nel database
    const allDocs = await collection.find({}).toArray();
    const reportByComune = {};
    const reportByTipo = {};
    const reportByZona = {};

    allDocs.forEach((doc) => {
      const comune = doc.comune || doc.metadata?.comune || "Sconosciuto";
      const tipo = doc.tipo || doc.metadata?.tipo || "sconosciuto";
      const zona = doc.zona || doc.metadata?.zona;

      reportByComune[comune] = (reportByComune[comune] || 0) + 1;
      reportByTipo[tipo] = (reportByTipo[tipo] || 0) + 1;
      if (zona) {
        reportByZona[zona] = (reportByZona[zona] || 0) + 1;
      }
    });

    console.log("\n📊 REPORT FINALE:");
    console.log("=".repeat(50));
    console.log("📍 Distribuzione per COMUNE:");
    Object.entries(reportByComune).forEach(([comune, count]) => {
      console.log(`   ${comune}: ${count} chunks`);
    });

    if (Object.keys(reportByZona).length > 0) {
      console.log("\n🗺️ Distribuzione per ZONA:");
      Object.entries(reportByZona).forEach(([zona, count]) => {
        console.log(`   ${zona}: ${count} chunks`);
      });
    }

    console.log("\n📋 Distribuzione per TIPO:");
    Object.entries(reportByTipo).forEach(([tipo, count]) => {
      console.log(`   ${tipo}: ${count} chunks`);
    });

    console.log("\n" + "=".repeat(50));
    console.log("✅ Done - Embedding completato con successo!");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ ${message}`);
  process.exit(1);
});
