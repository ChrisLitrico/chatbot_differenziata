# Garby — Chatbot RAG per la Raccolta Differenziata in Sicilia

**Garby** è un assistente virtuale che risponde a domande sulla raccolta differenziata, isole ecologiche e smaltimento rifiuti in 7 comuni siciliani. Il sistema si basa su un'architettura **RAG (Retrieval-Augmented Generation)** con ricerca vettoriale su MongoDB Atlas e generazione di risposte tramite Perplexity AI.

---

## Sommario

- [Cos'è il RAG](#cosè-il-rag)
- [Architettura del Sistema](#architettura-del-sistema)
- [Embedding](#embedding)
- [Retrieval](#retrieval)
- [Generazione (LLM)](#generazione-llm)
- [Frontend](#frontend)
- [Knowledge Base](#knowledge-base)
- [Deployment](#deployment)
- [Variabili d'Ambiente](#variabili-dambiente)
- [Dipendenze](#dipendenze)

---

## Cos'è il RAG

**RAG (Retrieval-Augmented Generation)** è un pattern architetturale che combina la ricerca di informazioni (retrieval) con la generazione di testo tramite un Large Language Model (LLM).

Il problema che risolve: i modelli LLM hanno una conoscenza statica, limitata ai dati di addestramento. Non conoscono dati privati, aggiornati o specifici di un dominio (come i calendari della raccolta differenziata di un comune).

Il RAG funziona in 3 fasi:

1. **Indicizzazione (offline)** — i documenti vengono suddivisi in chunk, trasformati in vettori numerici (embeddings) e salvati in un database vettoriale.
2. **Retrieval (runtime)** — la domanda dell'utente viene convertita in embedding e confrontata con i vettori dei documenti tramite similarità coseno. I chunk più rilevanti vengono recuperati.
3. **Generazione (runtime)** — i chunk recuperati vengono iniettati nel prompt come contesto, e il LLM genera una risposta basandosi esclusivamente su quei dati.

```
Domanda utente
    ↓
Embedding della query (OpenAI)
    ↓
Vector Search su MongoDB Atlas (similarità coseno)
    ↓
Top-K documenti rilevanti
    ↓
Prompt = System Instructions + Contesto RAG + Domanda
    ↓
LLM (Perplexity AI) → Risposta in streaming
```

---

## Architettura del Sistema

```
┌──────────────┐     POST /api/chat      ┌──────────────────┐
│   Frontend   │ ───────────────────────► │  Next.js API      │
│  (React +    │                          │  Route Handler    │
│  AI SDK v5)  │ ◄─── SSE stream ─────── │                   │
└──────────────┘                          └────────┬─────────┘
                                                   │
                                    1. Embed query  │  2. Vector Search
                                    (OpenAI)        │  (MongoDB Atlas)
                                                   │
                                          ┌────────▼─────────┐
                                          │   RAG Module      │
                                          │   (rag.ts)        │
                                          └────────┬─────────┘
                                                   │
                                    3. Prompt +     │  4. Streaming
                                       contesto    │     response
                                                   │
                                          ┌────────▼─────────┐
                                          │  Perplexity AI    │
                                          │  (modello sonar)  │
                                          └──────────────────┘
```

---

## Embedding

L'embedding è il processo che trasforma testo in vettori numerici, consentendo il confronto semantico tra documenti e query.

### Modello

| Parametro              | Valore                                   |
| ---------------------- | ---------------------------------------- |
| Modello                | `text-embedding-3-small` (OpenAI)        |
| Libreria               | `@langchain/openai` (`OpenAIEmbeddings`) |
| Dimensionalità vettore | **512**                                  |

### Chunking

I documenti vengono suddivisi in chunk più piccoli prima della vettorizzazione. La strategia di chunking influenza direttamente la qualità del retrieval.

| Parametro                          | Valore                             |
| ---------------------------------- | ---------------------------------- |
| Chunk size                         | **700 caratteri**                  |
| Chunk overlap                      | **100 caratteri**                  |
| Separatori (in ordine di priorità) | `\n## `, `\n### `, `\n---`, `\n\n` |

I separatori gerarchici garantiscono che i chunk rispettino la struttura logica dei documenti Markdown: prima si tenta di dividere per heading H2, poi H3, poi separatori orizzontali, infine doppio a-capo.

L'overlap di 100 caratteri assicura continuità di contesto tra chunk adiacenti.

### Metadata

Ogni chunk viene arricchito con metadata estratti automaticamente:

| Campo     | Esempio              | Estrazione                                    |
| --------- | -------------------- | --------------------------------------------- |
| `comune`  | `Catania`            | Derivato dal nome del file sorgente           |
| `tipo`    | `calendario_rifiuti` | Classificato via pattern regex nel testo      |
| `zona`    | `Nord`               | Estratta dal contenuto (Zona Nord/Centro/Sud) |
| `source`  | `catania.md`         | Nome file originale                           |
| `fonte`   | URL sito ufficiale   | Estratto dal file YAML associato              |
| `gestore` | `Supereco`           | Estratto dal file YAML associato              |

I valori possibili per `tipo`: `calendario_rifiuti`, `isola_ecologica`, `rifiuti_ammessi`, `orari`, `altro`.

### Schema documento in MongoDB

```json
{
  "text": "contenuto del chunk",
  "embedding": [0.012, -0.034, ...],
  "metadata": {
    "comune": "Catania",
    "tipo": "calendario_rifiuti",
    "zona": "Nord",
    "source": "catania.md",
    "fonte": "https://...",
    "gestore": "Supereco"
  }
}
```

### Script di indicizzazione

Lo script `createEmbeddings.mjs` esegue l'intero processo offline:

1. Legge tutti i file `.md` e `.yaml` dalla knowledge base
2. Suddivide in chunk con separatori gerarchici
3. Estrae metadata (comune, tipo, zona, URL)
4. Genera embeddings tramite OpenAI
5. Elimina i vecchi chunk con lo stesso `source` (deduplicazione)
6. Inserisce i nuovi chunk in MongoDB Atlas

Esecuzione: `pnpm embed` oppure `node createEmbeddings.mjs`

---

## Retrieval

Il retrieval è la fase in cui, data una domanda dell'utente, vengono recuperati i chunk di testo più pertinenti dal database vettoriale.

### Indice Vettoriale (MongoDB Atlas)

| Parametro             | Valore                   |
| --------------------- | ------------------------ |
| Nome indice           | `vector_index_1`         |
| Tipo                  | Atlas Vector Search      |
| Campo vettore         | `embedding`              |
| Dimensioni            | 512                      |
| Metrica di similarità | **cosine**               |
| Filtri definiti       | `comune`, `tipo`, `zona` |

La **similarità coseno** misura l'angolo tra due vettori nello spazio ad alta dimensionalità. Valori vicini a 1 indicano alta similarità semantica, valori vicini a 0 indicano bassa similarità.

### Pipeline di ricerca

| Fase                    | Parametro       | Valore           |
| ----------------------- | --------------- | ---------------- |
| Fetch da MongoDB        | `limit`         | **12** documenti |
| Candidati esaminati     | `numCandidates` | **120**          |
| Documenti finali al LLM | `MAX_RESULTS`   | **4**            |

La pipeline MongoDB Aggregation:

1. `$vectorSearch` — ricerca vettoriale con 120 candidati, restituisce 12 risultati
2. `$set` — aggiunge lo score di similarità a ogni documento
3. `$project` — seleziona solo i campi necessari (text, metadata, score)

### Post-filtering e Re-ranking

Dopo il vector search, i risultati vengono filtrati e riordinati in-memory:

1. **Detect città** — la query viene analizzata per identificare il comune (con supporto alias, es. "syracuse" → Siracusa)
2. **Detect zona** — identificazione della zona geografica (Nord, Centro, Sud, con alias come "meridionale" → Sud)
3. **Prioritizzazione comune** — i documenti del comune rilevato vengono spostati in cima
4. **Prioritizzazione zona** — i documenti della zona rilevata vengono spostati in cima
5. **Deduplicazione** — rimozione duplicati per chiave `source + contenuto`
6. **Selezione finale** — i primi 4 documenti vengono passati al LLM

> **Nota**: i filtri definiti nell'indice (`comune`, `tipo`, `zona`) non vengono usati nella query `$vectorSearch` ma solo in post-filtering. Questo approccio sacrifica una leggera efficienza a favore di maggiore flessibilità nel ranking.

### Fallback testuale

Se il vector search fallisce o restituisce zero risultati, viene attivata una ricerca testuale di backup:

- Estrae fino a 4 keyword dalla query (rimuovendo stop words italiane)
- Esegue una ricerca regex `$regex` sulla collection
- Restituisce fino a 12 risultati

---

## Generazione (LLM)

La generazione è la fase in cui il contesto recuperato viene usato per produrre una risposta naturale.

### Modello

| Parametro | Valore                                       |
| --------- | -------------------------------------------- |
| Provider  | **Perplexity AI**                            |
| Modello   | `sonar`                                      |
| Endpoint  | `https://api.perplexity.ai/chat/completions` |
| Streaming | SSE (Server-Sent Events)                     |
| Timeout   | 60 secondi                                   |

### System Prompt

Il prompt di sistema definisce il comportamento del chatbot:

- **Ambito**: esclusivamente raccolta differenziata, riciclo, smaltimento rifiuti, isole ecologiche in Sicilia
- **Regola fondamentale**: usa SOLO le parti pertinenti del contesto RAG, ignora informazioni non rilevanti
- **Rifiuto off-topic**: domande non pertinenti ricevono un rifiuto gentile
- **Stile**: naturale, conciso, amichevole
- **Emoji per tipologia**: 🍕 organico, 📦 carta, 🪣 plastica, 🫙 vetro, 🗑️ indifferenziato
- **Formato calendari**: `[Tipo] → [Giorno/i]`
- **Link**: raccolti in una sezione finale unica `📎 Link utili:`
- **Fallback**: indicazioni generiche + suggerimento sito ufficiale se mancano dati specifici

### Bridging SSE → AI SDK v5

Poiché Perplexity AI non è direttamente supportata dall'AI SDK, il server implementa un bridging manuale:

1. Riceve lo stream SSE da Perplexity
2. Rimuove i citation markers (`[1]`, `[5][8]`) dal testo
3. Re-formatta nel protocollo **UIMessageStream** di AI SDK v5:
   - `start` → `text-start` → `text-delta` (chunk incrementali) → `text-end` → `finish`

---

## Frontend

### Stack tecnologico

| Tecnologia         | Versione             | Ruolo                                       |
| ------------------ | -------------------- | ------------------------------------------- |
| **Next.js**        | 15.4.6               | Framework React con App Router e API Routes |
| **React**          | 18.3.1               | Libreria UI                                 |
| **TypeScript**     | 5.3+                 | Type safety                                 |
| **Tailwind CSS**   | 3.3.2                | Styling utility-first                       |
| **AI SDK**         | v5 (`ai` 5.0.136)    | Protocollo streaming chat                   |
| **@ai-sdk/react**  | 2.0.10               | Hook `useChat()` per gestione stato chat    |
| **react-markdown** | 9.0.1                | Rendering Markdown nelle risposte           |
| **react-icons**    | 5.5.0                | Icone UI (IoSend, HiOutlinePlus)            |
| **Font**           | Inter (Google Fonts) | Tipografia                                  |

### Gestione dello stato chat

Il componente principale (`page.tsx`) utilizza l'hook `useChat()` di `@ai-sdk/react` che gestisce:

- Lista messaggi (utente + assistente)
- Invio messaggi al backend
- Ricezione e rendering dello streaming
- Stati: `submitted`, `streaming`, `ready`, `error`
- Funzione `stop()` per interrompere la generazione
- Funzione `reload()` per rigenerare l'ultima risposta

**La conversazione non è persistita**: vive esclusivamente nello stato React del client.

### Layout e UI

**Due modalità di visualizzazione:**

| Stato                          | Layout                                                    |
| ------------------------------ | --------------------------------------------------------- |
| **Landing** (nessun messaggio) | Logo in alto a sinistra, input centrato, branding "Garby" |
| **Chat** (con messaggi)        | Area messaggi scrollabile, input fisso in basso           |

**Stile messaggi:**

| Ruolo      | Stile                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------- |
| Utente     | Bolla rosa (`bg-pink-200`), allineata a destra, animazione slide-right                    |
| Assistente | Bolla verde chiaro (`bg-green-50`), bordo viola, avatar a sinistra, animazione slide-left |

**Indicatori di stato:**

- **Typing**: 3 pallini animati con bounce (mostrati quando il messaggio assistente è vuoto durante lo streaming)
- **Elaborazione**: label pulsante con animazione glow
- **Errore**: messaggio rosso + pulsante "Riprova"

### Componente Input

- **Textarea** auto-expanding (altezza massima 192px)
- **Enter** per inviare, **Shift+Enter** per nuova riga
- Pulsante **"Nuova chat"** (icona +) visibile solo durante una conversazione
- Animazione **pop** sul pulsante di invio
- Rilevamento mobile (`window.innerWidth < 768`) per adattamento comportamento

### Scroll automatico

Un hook custom (`useSmoothScrollToBottom`) gestisce lo smooth scroll durante lo streaming:

- Monitora la lunghezza del messaggio in arrivo
- Scrolla verso il basso ogni 100ms durante lo streaming
- Cleanup automatico al termine

### Animazioni CSS

| Animazione         | Utilizzo                            |
| ------------------ | ----------------------------------- |
| `fadeSlideIn`      | Elementi generici (landing, errori) |
| `fadeSlideInLeft`  | Messaggi dell'assistente            |
| `fadeSlideInRight` | Messaggi dell'utente                |
| `typingBounce`     | Pallini typing indicator            |
| `pulseGlow`        | Label "Elaborazione..."             |
| `sendPop`          | Pulsante di invio                   |

---

## Knowledge Base

### Struttura dati

La knowledge base copre **7 comuni siciliani**: Catania, Messina, Palermo, Ragusa, Siracusa, Trapani, Agrigento.

Per ogni comune sono presenti 4 file nella directory `data/gestione_rifiuti_docs/`:

| File                             | Formato  | Contenuto                                                                              |
| -------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `{comune}.md`                    | Markdown | Calendario raccolta per zona, dettagli per tipologia rifiuto, rifiuti speciali         |
| `{comune}.yaml`                  | YAML     | Dati strutturati: zone, gestori, raccolta per giorno, categorie ammesse/rifiutate, URL |
| `{comune}_isole_ecologiche.md`   | Markdown | Lista isole ecologiche con indirizzi e rifiuti conferibili                             |
| `{comune}_isole_ecologiche.yaml` | YAML     | Dati strutturati isole: nome, indirizzo, rifiuti ammessi per categoria                 |

Il doppio formato (Markdown + YAML) serve a:

- **Markdown**: testo leggibile ottimizzato per il consumo del LLM
- **YAML**: metadati strutturati (URL, contatti gestori) iniettati nei chunk

---

## Deployment

| Parametro       | Valore                   |
| --------------- | ------------------------ |
| Piattaforma     | **Netlify**              |
| Runtime         | Node.js 20               |
| Package manager | pnpm                     |
| Plugin          | `@netlify/plugin-nextjs` |
| Output          | `.next` directory        |

---

## Variabili d'Ambiente

| Variabile              | Obbligatoria | Default                  | Descrizione                     |
| ---------------------- | ------------ | ------------------------ | ------------------------------- |
| `MONGODB_ATLAS_URI`    | Sì           | —                        | Connection string MongoDB Atlas |
| `PERPLEXITY_API_KEY`   | Sì           | —                        | API key Perplexity AI           |
| `OPENAI_API_KEY`       | Sì           | —                        | API key OpenAI (per embeddings) |
| `EMBEDDING_MODEL`      | No           | `text-embedding-3-small` | Modello embedding OpenAI        |
| `PERPLEXITY_MODEL`     | No           | `sonar`                  | Modello LLM Perplexity          |
| `RAG_RESULTS`          | No           | `4`                      | Numero documenti RAG restituiti |
| `MONGODB_VECTOR_INDEX` | No           | `vector_index_1`         | Nome indice vettoriale          |
| `MONGODB_VECTOR_PATH`  | No           | `embedding`              | Campo vettore nel documento     |

---

## Dipendenze

### Produzione

| Package               | Versione | Ruolo                 |
| --------------------- | -------- | --------------------- |
| `next`                | ^15.4.6  | Framework SSR/SSG     |
| `react` / `react-dom` | ^18.3.1  | UI library            |
| `ai`                  | 5.0.136  | Vercel AI SDK v5      |
| `@ai-sdk/react`       | ^2.0.10  | Hook React per chat   |
| `@langchain/openai`   | ^0.6.7   | OpenAI embeddings     |
| `mongodb`             | ^5.9.0   | Driver MongoDB        |
| `react-markdown`      | ^9.0.1   | Rendering Markdown    |
| `react-icons`         | ^5.5.0   | Icone UI              |
| `tailwindcss`         | ^3.3.2   | CSS utility framework |
| `zod`                 | ^4.0.17  | Schema validation     |
| `dotenv`              | ^16.3.1  | Variabili d'ambiente  |

### Sviluppo

| Package                             | Versione          |
| ----------------------------------- | ----------------- |
| `typescript`                        | ^5.3.0            |
| `eslint` + `eslint-config-next`     | ^8.57.0 / ^15.4.6 |
| `@types/node`                       | ^20.0.0           |
| `@types/react` / `@types/react-dom` | ^18.3.1           |
