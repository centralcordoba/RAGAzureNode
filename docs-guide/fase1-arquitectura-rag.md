# Fase 1 - Arquitectura del RAG Local

## Qué es un RAG

RAG (Retrieval-Augmented Generation) es un patrón de arquitectura que combina búsqueda de información con generación de texto mediante un LLM. En lugar de depender solo de lo que el modelo "sabe" (su entrenamiento), le damos contexto específico extraído de nuestros documentos.

```
Sin RAG:  Usuario → LLM → Respuesta (puede alucinar)
Con RAG:  Usuario → Buscar en docs → LLM + contexto → Respuesta fundamentada
```

**Por qué RAG para healthcare:** En entornos regulados, las respuestas deben ser precisas y trazables. Un LLM genérico podría inventar penalidades o confundir regulaciones. Con RAG, cada respuesta está anclada a documentos verificables.

---

## Pipeline completo

```
┌─────────────────────────────────────────────────────────────────┐
│                     INGESTA (offline, una vez)                  │
│                                                                 │
│  Documentos    Chunking        Embeddings         Vector Store  │
│  (.txt)    →   (split)    →   (Azure OpenAI)  →  (en memoria)  │
│  5 archivos    55 chunks       1536 dimensiones    JSON disco   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     CONSULTA (cada request)                     │
│                                                                 │
│  Pregunta  →  Embedding  →  Búsqueda   →  Prompt  →  LLM  →  │
│  del user     query         similaridad   template    Mistral   │
│               1536-dim      topK=4        anti-aluc.  Nemo      │
│                                                                 │
│                                           ↓                     │
│                                      Respuesta con              │
│                                      citas de fuentes           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Componentes en detalle

### 1. Documentos fuente (`docs/`)

Cinco archivos `.txt` sobre regulaciones healthcare de EEUU:

| Archivo | Regulación | Contenido clave |
|---------|-----------|-----------------|
| `hipaa.txt` | HIPAA (1996) | Privacy Rule, Security Rule, Breach Notification, penalties |
| `hitech.txt` | HITECH Act (2009) | Meaningful Use, tiered penalties, business associate liability |
| `42cfr_part2.txt` | 42 CFR Part 2 | Confidencialidad de registros de abuso de sustancias |
| `fda_21cfr11.txt` | FDA 21 CFR Part 11 | Registros electrónicos y firmas electrónicas |
| `state_health_privacy_laws.txt` | Leyes estatales | California CMIA, Texas HB 300, NY SHIELD, etc. |

**Decisión:** Usamos `.txt` plano por simplicidad. En producción se usarían loaders de LangChain para PDF, Word, HTML, etc.

---

### 2. Chunking (`src/ingest.js`)

**Qué es:** Partir documentos largos en fragmentos pequeños que puedan ser buscados individualmente.

**Algoritmo:** `RecursiveCharacterTextSplitter` de LangChain.

```
Documento completo (3000+ chars)
    ↓
Intenta partir por: \n\n (párrafos)
    ↓ si el chunk sigue siendo > 500 chars
Intenta partir por: \n (líneas)
    ↓ si sigue siendo > 500 chars
Intenta partir por: ". " (oraciones)
    ↓ si sigue siendo > 500 chars
Parte por: " " (palabras)
    ↓
Resultado: chunks de ~500 chars con overlap de 100
```

**Configuración elegida:**

| Parámetro | Valor | Razón |
|-----------|-------|-------|
| `chunkSize` | 500 chars | Chunks pequeños = retrieval más preciso. Texto regulatorio tiene secciones densas; 500 chars captura ~1 concepto completo |
| `chunkOverlap` | 100 chars | ~1-2 oraciones compartidas entre chunks adyacentes. Previene perder contexto en los bordes |
| `separators` | `["\n\n", "\n", ". ", " ", ""]` | Prioriza cortes naturales del texto |

**Resultado:** 5 documentos → 55 chunks.

**Por qué importa el overlap:** Si una regulación dice "La penalidad es de $50,000" al final de un chunk y "por violación, con un máximo anual de $1.5M" al inicio del siguiente, sin overlap perderíamos la conexión.

---

### 3. Embeddings (`src/embeddings.js`)

**Qué es:** Convertir texto en vectores numéricos que capturan el significado semántico. Textos con significado similar producen vectores cercanos en el espacio.

```
"HIPAA penalties for violations"  →  [0.023, -0.041, 0.087, ..., 0.012]  (1536 números)
"Fines under HIPAA regulation"    →  [0.025, -0.039, 0.091, ..., 0.010]  (vectores similares)
"Recipe for chocolate cake"       →  [-0.082, 0.054, -0.023, ..., 0.076] (vector muy diferente)
```

**Modelo:** `text-embedding-3-small` de Azure OpenAI.

| Propiedad | Valor |
|-----------|-------|
| Dimensiones | 1536 |
| Costo | ~$0.02 / 1M tokens |
| Proveedor | Azure OpenAI |

**Por qué Azure OpenAI y no OpenRouter:** OpenRouter no soporta modelos de embeddings (solo chat/completion). Azure OpenAI es la opción profesional porque:
- Los datos no salen del ecosistema Azure (compliance healthcare)
- Mismo proveedor que usaremos para Azure AI Search en Fase 2
- En entornos regulados, minimizar proveedores reduce superficie de riesgo

**Detalle técnico:** Usamos `AzureOpenAIEmbeddings` de LangChain con variables de entorno con prefijo `AZURE_EMBED_*` (no `AZURE_OPENAI_*`) para evitar que `ChatOpenAI` auto-detecte las credenciales Azure y cambie de modo.

---

### 4. Vector Store (`MemoryVectorStore`)

**Qué es:** Una base de datos que almacena vectores y permite buscar los más similares a un vector de consulta.

**Implementación actual:** `MemoryVectorStore` de LangChain — almacena todo en RAM.

**Persistencia:** Serializamos los vectores a `vectorstore.json` después de la ingesta. Cuando el server arranca, carga el JSON directamente sin re-generar embeddings.

```
Ingesta:  docs → chunks → embeddings → RAM → vectorstore.json (disco)
Server:   vectorstore.json (disco) → RAM → listo para queries
```

**Por qué serializar a JSON:** Cada llamada a la API de embeddings cuesta dinero. Sin serialización, reiniciar el server significaría re-embeder los 55 chunks cada vez. Con el JSON, solo pagamos una vez.

**Limitación:** Esto es solo para el PoC. En Fase 2 reemplazamos por Azure AI Search (persistente, escalable, búsqueda híbrida).

---

### 5. Retrieval (búsqueda por similaridad)

**Qué hace:** Cuando llega una pregunta, la convierte en vector y busca los chunks más similares.

```
Pregunta: "What are HIPAA penalties?"
    ↓
Embedding de la pregunta → vector de 1536 dims
    ↓
Búsqueda por similaridad coseno contra los 55 chunks
    ↓
Top 4 chunks más relevantes (topK = 4)
```

**topK = 4:** Balance entre:
- Muy pocos (1-2): puede faltar contexto relevante
- Muchos (8-10): más tokens al LLM = más costo + más ruido = peor respuesta

Para regulaciones healthcare, 4 chunks (~2000 chars de contexto) es suficiente para responder la mayoría de preguntas con precisión.

---

### 6. Prompt Template anti-alucinación (`src/rag.js`)

```
You are a healthcare regulatory compliance expert. Answer the question
based ONLY on the following context. If the context does not contain
enough information to answer the question, say "I don't have enough
information to answer that question based on the available documents."

IMPORTANT RULES:
- Only use information from the provided context
- Do not make up or infer information not explicitly stated
- Cite the source document for each piece of information
- Be precise with regulatory names, penalties, and requirements
- If multiple regulations apply, mention all relevant ones

Context:
{context}

Question: {question}
```

**Decisiones de diseño del prompt:**

| Técnica | Por qué |
|---------|---------|
| **Role framing** ("healthcare regulatory compliance expert") | Activa el conocimiento del dominio en el modelo |
| **"ONLY on the following context"** | Restricción explícita: no usar conocimiento del entrenamiento |
| **"Say I don't have enough information"** | Previene alucinación cuando no hay respuesta en los docs |
| **"Cite the source document"** | Trazabilidad: el usuario sabe de dónde viene cada dato |
| **"Be precise with regulatory names, penalties"** | En healthcare, un número incorrecto puede tener consecuencias legales |
| **"If multiple regulations apply"** | Las regulaciones se superponen (HIPAA + HITECH + state laws) |

---

### 7. LLM Chat (`src/llm.js`)

**Modelo:** `mistralai/mistral-nemo` via OpenRouter.

| Propiedad | Valor | Razón |
|-----------|-------|-------|
| Modelo | Mistral Nemo | Buena calidad para Q&A, marca conocida |
| Costo input | $0.02/1M tokens | Extremadamente económico |
| Costo output | $0.04/1M tokens | |
| `temperature` | 0.1 | Near-deterministic: para Q&A regulatorio queremos consistencia, no creatividad |
| `maxTokens` | 512 | Limita el largo de respuesta (control de costos) |

**Por qué OpenRouter y no Azure OpenAI para chat:** Azure OpenAI cobra más por los modelos de chat (~$0.50-$15/1M tokens según modelo). OpenRouter ofrece modelos competentes a fracción del costo. Para un PoC, esta separación (Azure para embeddings, OpenRouter para chat) optimiza costos.

---

### 8. Server Express (`src/index.js`)

**Endpoint principal:**

```
POST /ask
Content-Type: application/json

{
  "question": "What are the penalties for HIPAA violations?"
}
```

**Respuesta:**

```json
{
  "answer": "HIPAA violations can result in civil monetary penalties...",
  "sources": ["hipaa.txt", "hitech.txt"],
  "chunksRetrieved": 4,
  "elapsedMs": 7293
}
```

**Controles implementados:**
- Validación de input (tipo string, requerido)
- Límite de 500 caracteres (mitiga prompt injection + controla costos)
- Try/catch con error logging
- Health check endpoint (`GET /health`)

---

## Estructura de archivos

```
RAGAzureNode/
├── docs/                        # Documentos fuente
│   ├── hipaa.txt
│   ├── hitech.txt
│   ├── 42cfr_part2.txt
│   ├── fda_21cfr11.txt
│   └── state_health_privacy_laws.txt
├── src/
│   ├── config.js                # Configuración centralizada
│   ├── embeddings.js            # Azure OpenAI embeddings
│   ├── llm.js                   # Mistral Nemo via OpenRouter
│   ├── ingest.js                # Pipeline de ingesta
│   ├── rag.js                   # Chain: retrieve → prompt → LLM
│   └── index.js                 # Express server
├── vectorstore.json             # Vectores serializados (no re-embed)
├── .env                         # API keys (no se commitea)
├── .gitignore
└── package.json
```

---

## Flujo de datos completo

```
1. INGESTA (npm run ingest) - se ejecuta UNA vez

   hipaa.txt ──→ RecursiveCharacterTextSplitter ──→ 12 chunks ─┐
   hitech.txt ─→ RecursiveCharacterTextSplitter ──→ 10 chunks ─┤
   42cfr.txt ──→ RecursiveCharacterTextSplitter ──→ 11 chunks ─┼→ Azure OpenAI
   fda.txt ────→ RecursiveCharacterTextSplitter ──→ 12 chunks ─┤   embeddings
   state.txt ──→ RecursiveCharacterTextSplitter ──→ 10 chunks ─┘      ↓
                                                              vectorstore.json
                                                              (55 vectores x 1536 dims)

2. CONSULTA (POST /ask) - cada request

   "What are HIPAA penalties?"
       ↓
   Azure OpenAI embedding (1 API call)
       ↓
   Similaridad coseno vs 55 vectores
       ↓
   Top 4 chunks más relevantes
       ↓
   Prompt template + contexto + pregunta
       ↓
   Mistral Nemo via OpenRouter (1 API call)
       ↓
   { answer, sources, elapsedMs }
```

---

## Costo por request estimado

| Operación | Tokens aprox. | Costo |
|-----------|--------------|-------|
| Embedding de la pregunta | ~20 tokens | $0.0000004 |
| LLM input (prompt + context + question) | ~1500 tokens | $0.00003 |
| LLM output (respuesta) | ~200 tokens | $0.000008 |
| **Total por request** | | **~$0.00004** |

Esto significa que podrías hacer **~25,000 preguntas por $1 USD**.

---

## Lecciones aprendidas en esta fase

1. **OpenRouter no soporta embeddings** → solución: separar proveedores (Azure para embeddings, OpenRouter para chat)
2. **LangChain auto-detecta `AZURE_OPENAI_*` env vars** → solución: usar prefijo custom `AZURE_EMBED_*`
3. **Express 5 tiene bugs con async handlers** → solución: usar Express 4 (estable)
4. **Modelos free de OpenRouter tienen rate limits agresivos** → solución: usar modelo pago barato (Mistral Nemo, $0.02/1M)
5. **Serializar vectores a JSON** evita re-embeddings costosos en cada reinicio
