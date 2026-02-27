# Fase 2 — Azure AI Search e Ingesta

## Qué cambió de Fase 1 a Fase 2

| Aspecto | Fase 1 | Fase 2 |
|---------|--------|--------|
| Vector Store | MemoryVectorStore (RAM) | Azure AI Search (cloud) |
| Persistencia | JSON en disco | Índice en Azure |
| Tipo de búsqueda | Solo vectorial | Híbrida (vector + keyword) |
| Escalabilidad | ~1000 chunks máx | Millones de documentos |
| Disponibilidad | Se pierde si el proceso muere | Siempre disponible en Azure |

---

## Qué es la ingesta

La ingesta es el proceso de preparar los documentos para que el sistema RAG pueda buscar en ellos. Es un proceso **offline** (se ejecuta una vez, o cada vez que se agregan/actualizan documentos) y tiene 4 etapas:

```
Archivos .txt → Chunking → Embeddings → Upload a Azure AI Search
(5 archivos)    (55 chunks)  (55 vectores)  (55 documentos en el índice)
```

### Etapa 1: Carga de archivos

Se leen los 5 archivos `.txt` del directorio `docs/`:

```
hipaa.txt                     → 3,166 caracteres
hitech.txt                    → 2,924 caracteres
42cfr_part2.txt               → 3,500 caracteres
fda_21cfr11.txt               → 3,878 caracteres
state_health_privacy_laws.txt → 4,776 caracteres
                                ──────────────────
Total:                          18,244 caracteres
```

### Etapa 2: Chunking (fragmentación)

Cada archivo se divide en fragmentos de ~500 caracteres con 100 caracteres de solapamiento.

**Ejemplo visual con hipaa.txt:**

```
Texto original (3,166 chars):
┌──────────────────────────────────────────────────────────────────────────┐
│ HIPAA - Health Insurance Portability... Overview: HIPAA was enacted ... │
│ Privacy Rule: The HIPAA Privacy Rule establishes national standards ... │
│ Security Rule: The HIPAA Security Rule establishes... safeguards ...    │
│ Breach Notification Rule: ... notify affected individuals ...          │
│ Enforcement: HIPAA violations can result in civil monetary penalties .. │
│ Minimum Necessary Standard: ...                                        │
│ Business Associate Agreements: ...                                     │
│ Patient Rights: Under HIPAA, patients have the right to ...            │
└──────────────────────────────────────────────────────────────────────────┘

Después del chunking (12 chunks):
┌─────── chunk 1 ───────┐
│ HIPAA - Health Insuran │
│ ce Portability...      │
│ Overview: HIPAA was    │
│ enacted in 1996...     │
└───────┬───────────────┘
        │ overlap (100 chars)
        ▼
┌─────── chunk 2 ───────┐
│ ...enacted in 1996 and │
│ is the foundational... │
│ Privacy Rule: The HIPA │
│ A Privacy Rule...      │
└───────┬───────────────┘
        │ overlap
        ▼
      (... y así sucesivamente)
```

**Por qué fragmentar:**
- Un LLM tiene un límite de tokens de entrada. No podemos pasarle los 5 archivos completos.
- Chunks pequeños permiten buscar con precisión. Si alguien pregunta por "HIPAA penalties", solo necesitamos el chunk que habla de penalties, no todo el documento.

**Por qué el solapamiento:**
- Evita perder contexto en los bordes. Si una oración empieza en un chunk y termina en otro, el overlap garantiza que la oración completa aparezca en al menos uno de los dos.

**Resultado:** 5 archivos → 55 chunks.

### Etapa 3: Embeddings (vectorización)

Cada chunk de texto se envía a Azure OpenAI (`text-embedding-3-small`) para convertirlo en un vector de 1,536 números.

```
"HIPAA violations can result in        →  [0.023, -0.041, 0.087, 0.012,
 civil monetary penalties ranging          -0.055, 0.031, 0.094, -0.008,
 from $100 to $50,000 per violation"       ..., 0.019]  (1,536 números)
```

**Qué representan estos números:** Cada dimensión del vector captura un aspecto del significado del texto. Textos semánticamente similares producen vectores cercanos:

```
"HIPAA penalties for violations"    →  vector A: [0.023, -0.041, ...]
"Fines under HIPAA regulation"      →  vector B: [0.025, -0.039, ...]  ← muy cercano a A
"Recipe for chocolate cake"         →  vector C: [-0.082, 0.054, ...]  ← muy lejano de A
```

La "distancia" entre vectores se mide con **similaridad coseno** (1.0 = idénticos, 0.0 = sin relación).

**Costo:** 55 chunks × ~100 tokens/chunk = ~5,500 tokens → ~$0.0001 (prácticamente gratis).

### Etapa 4: Upload a Azure AI Search

Cada chunk se convierte en un documento con esta estructura y se sube al índice:

```json
{
  "id": "a3f8c2e1d4b5...",
  "content": "HIPAA violations can result in civil monetary penalties ranging from $100 to $50,000...",
  "contentVector": [0.023, -0.041, 0.087, ...],
  "source": "hipaa.txt"
}
```

| Campo | Tipo | Para qué sirve |
|-------|------|----------------|
| `id` | string | Identificador único (hash MD5 del contenido) |
| `content` | string | Texto del chunk (para búsqueda keyword y para mostrar) |
| `contentVector` | float[1536] | Vector del embedding (para búsqueda vectorial) |
| `source` | string | Archivo de origen (para citar fuentes) |

---

## El índice en Azure AI Search

### Qué es un índice

Un índice es como una tabla de base de datos optimizada para búsqueda. Tiene un esquema fijo (campos definidos) y los documentos se almacenan siguiendo ese esquema.

```
Índice: "healthcare-regulations"
┌────────────────┬─────────────────────────────────────┬───────────────┬──────────────────────────┐
│ id             │ content                             │ contentVector │ source                   │
├────────────────┼─────────────────────────────────────┼───────────────┼──────────────────────────┤
│ a3f8c2e1...    │ "HIPAA Overview: enacted in 1996.." │ [0.02, -0.04] │ hipaa.txt               │
│ b7d9e3f2...    │ "Privacy Rule: establishes..."     │ [0.01, 0.03]  │ hipaa.txt               │
│ c1a4f5b8...    │ "HITECH introduced tiered..."      │ [-0.01, 0.05] │ hitech.txt              │
│ ...            │ ...                                 │ ...           │ ...                      │
│ (55 filas)     │                                     │               │                          │
└────────────────┴─────────────────────────────────────┴───────────────┴──────────────────────────┘
```

### Configuración del índice

El campo `content` usa el analizador `en.microsoft` (inglés) que:
- Tokeniza el texto en palabras
- Aplica stemming ("violations" → "violat", "violating" → "violat")
- Elimina stop words ("the", "is", "and")
- Esto mejora la búsqueda keyword

El campo `contentVector` usa el algoritmo **HNSW** (Hierarchical Navigable Small World):
- Es un algoritmo de búsqueda aproximada de vecinos más cercanos
- Mucho más rápido que fuerza bruta en datasets grandes
- Métrica: similaridad coseno

---

## Búsqueda híbrida: cómo funciona

Cuando llega una pregunta, Azure AI Search ejecuta **dos búsquedas en paralelo** y combina los resultados:

### Ejemplo: "What are the 42 CFR Part 2 consent requirements?"

```
                    Pregunta del usuario
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
     Búsqueda Keyword (BM25)    Búsqueda Vectorial
     "42 CFR Part 2 consent"    vector([0.02, -0.01, ...])
              │                           │
              ▼                           ▼
     Encuentra chunks que        Encuentra chunks
     contengan las palabras      semánticamente similares
     "42", "CFR", "Part",        al concepto de
     "consent"                   "requisitos de consentimiento
              │                   en regulación de sustancias"
              │                           │
              └─────────────┬─────────────┘
                            ▼
                   Fusión de resultados
                   (Reciprocal Rank Fusion)
                            │
                            ▼
                   Top 4 chunks más relevantes
```

### Por qué necesitamos ambas búsquedas

| Escenario | Solo Keyword | Solo Vector | Híbrida |
|-----------|-------------|-------------|---------|
| "42 CFR Part 2" (término exacto) | Perfecto | Podría confundir con HIPAA | Perfecto |
| "reglas de privacidad para adicciones" (semántico, sin términos técnicos) | Falla (no menciona "42 CFR") | Perfecto | Perfecto |
| "HIPAA breach notification 60 days" (mixto) | Parcial | Parcial | Perfecto |

**En healthcare, la búsqueda híbrida es crítica** porque:
- Los reguladores usan terminología muy específica ("42 CFR Part 2", "21 CFR Part 11")
- Los usuarios pueden preguntar en lenguaje natural ("¿qué pasa si hackean un hospital?")
- Las regulaciones se cruzan entre sí (HIPAA + HITECH + leyes estatales)

---

## Código: los archivos de la Fase 2

### `src/search.js` (nuevo)

Módulo que maneja toda la interacción con Azure AI Search:

```
search.js
  ├── createIndex()       → Crea el índice con el esquema de campos
  ├── uploadDocuments()   → Sube los chunks al índice en batches
  └── hybridSearch()      → Ejecuta búsqueda híbrida (vector + keyword)
```

### `src/ingest.js` (modificado)

Antes:
```
load docs → chunk → embed → guardar en MemoryVectorStore → serializar a JSON
```

Después:
```
load docs → chunk → embed → crear índice en Azure → subir documentos
```

### `src/rag.js` (modificado)

Antes:
```
pregunta → embed pregunta → buscar en MemoryVectorStore → prompt + LLM → respuesta
```

Después:
```
pregunta → embed pregunta → búsqueda híbrida en Azure AI Search → prompt + LLM → respuesta
```

### `src/index.js` (simplificado)

Ya no necesita pre-cargar vectores en RAM al iniciar. Azure AI Search está siempre disponible.

---

## Flujo completo de una consulta (Fase 2)

```
1. Usuario envía: POST /ask { "question": "What are HIPAA penalties?" }

2. Express recibe y valida la pregunta

3. rag.js:
   a. Llama a Azure OpenAI para generar el embedding de la pregunta
      → 1 API call, ~20 tokens, ~$0.0000004

   b. Llama a Azure AI Search con búsqueda híbrida:
      - Envía el texto "What are HIPAA penalties?" (para keyword search)
      - Envía el vector [0.023, -0.041, ...] (para vector search)
      - Azure combina resultados y devuelve top 4 chunks
      → 1 API call, $0 (incluido en el plan)

   c. Construye el prompt:
      "You are a healthcare regulatory compliance expert...
       Context: [los 4 chunks]
       Question: What are HIPAA penalties?"

   d. Llama a Mistral Nemo via OpenRouter
      → 1 API call, ~1500 tokens input + ~200 output, ~$0.00004

4. Devuelve:
   {
     "answer": "HIPAA violations can result in civil monetary penalties...",
     "sources": ["hipaa.txt", "hitech.txt"],
     "chunksRetrieved": 4,
     "elapsedMs": 6292
   }

Total por request: ~$0.00004 (25,000 preguntas por $1 USD)
```

---

## Variables de entorno agregadas

```env
# Azure AI Search
AZURE_SEARCH_ENDPOINT=https://search-rag-poc-em2026.search.windows.net
AZURE_SEARCH_KEY=kXyFhm2ArPrpw38DPd...   (admin key)
AZURE_SEARCH_INDEX=healthcare-regulations
```

---

## Dependencia agregada

```bash
npm install @azure/search-documents
```

SDK oficial de Microsoft para interactuar con Azure AI Search desde Node.js. Permite crear índices, subir documentos, y ejecutar búsquedas.
