# Healthcare Regulatory Compliance RAG

An AI-powered assistant that answers questions about US healthcare regulations using Retrieval-Augmented Generation (RAG). Built with Node.js, LangChain, Azure AI Search, and Next.js.

**Live demo:** [ragfrontend.gentlerock-23836e73.westus2.azurecontainerapps.io](https://ragfrontend.gentlerock-23836e73.westus2.azurecontainerapps.io)

<img width="701" height="442" alt="image" src="https://github.com/user-attachments/assets/f375f128-31a2-4f46-9fa6-3699460f5253" />


## How It Works

```
User asks: "What are the penalties for HIPAA violations?"
                            |
                            v
                  +-------------------+
                  |   Input Validation |  Rate limiting, length check,
                  |   + Security       |  prompt injection detection
                  +--------+----------+
                           |
              +------------+------------+
              |                         |
              v                         v
   +------------------+    +----------------------+
   | Azure OpenAI     |    | Azure AI Search      |
   | Embeddings       |    | Hybrid Search        |
   | (text-embedding- |    | (Vector + BM25)      |
   | 3-small)         |    |                      |
   | Question -> Vec  |    | Returns top 4 chunks |
   +--------+---------+    +-----------+----------+
              |                         |
              +------------+------------+
                           |
                           v
                  +-------------------+
                  |   LLM (Mistral    |  Generates answer using
                  |   Nemo via        |  ONLY the retrieved context.
                  |   OpenRouter)     |  Anti-hallucination prompt.
                  +--------+----------+
                           |
                           v
                  +-------------------+
                  |   Response        |  Answer + source documents
                  |   + Cost Tracking |  + token count + cost estimate
                  +-------------------+
```

The system retrieves relevant chunks from a knowledge base of 5 US healthcare regulatory documents, then uses an LLM to generate grounded answers with source citations. It **never fabricates information** — if the context doesn't contain the answer, it says so.

## Regulatory Knowledge Base

| Document | Regulation | What it covers |
|----------|-----------|---------------|
| `hipaa.txt` | HIPAA | Privacy and security of Protected Health Information (PHI) |
| `hitech.txt` | HITECH Act | Electronic health records, breach notification requirements |
| `42cfr_part2.txt` | 42 CFR Part 2 | Substance use disorder treatment records (stricter than HIPAA) |
| `fda_21cfr11.txt` | FDA 21 CFR Part 11 | Electronic records and signatures in FDA-regulated industries |
| `state_health_privacy_laws.txt` | State Laws | State-specific privacy laws that exceed federal requirements |

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 16 + React 19 | Single-page UI with example questions and response display |
| **Backend** | Express.js + LangChain | REST API, RAG pipeline orchestration |
| **Embeddings** | Azure OpenAI (text-embedding-3-small) | Converts text to 1536-dim vectors for semantic search |
| **Vector Search** | Azure AI Search | Hybrid retrieval: vector similarity + keyword BM25 |
| **LLM** | Mistral Nemo via OpenRouter | Answer generation (~$0.00002 per query) |
| **Security** | express-rate-limit + regex patterns | Rate limiting, input validation, prompt injection detection |
| **Cost Tracking** | Custom module | Per-request token estimation and cost calculation |
| **Containerization** | Docker + Docker Compose | Multi-container local development |
| **Deployment** | Azure Container Apps | Serverless containers with scale-to-zero |
| **Registry** | Azure Container Registry | Private Docker image storage |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Azure Container Apps                          │
│                                                                  │
│   ┌──────────────────┐         ┌──────────────────────────┐     │
│   │   ragfrontend     │         │   ragbackend              │     │
│   │   Next.js         │  POST   │   Express                 │     │
│   │   Port 3000       │ ──────> │   Port 3001               │     │
│   │                   │  /ask   │                           │     │
│   │   - Example Qs    │ <────── │   ┌─────────────────────┐ │     │
│   │   - Answer card   │  JSON   │   │ Security Layer      │ │     │
│   │   - Source tags   │         │   │ - Rate limit 10/min │ │     │
│   │   - Cost metrics  │         │   │ - Input validation  │ │     │
│   └──────────────────┘         │   │ - Anti-injection     │ │     │
│                                 │   └─────────┬───────────┘ │     │
│                                 │             │             │     │
│                                 │   ┌─────────▼───────────┐ │     │
│                                 │   │ RAG Pipeline         │ │     │
│                                 │   │ 1. Embed question    │ │     │
│                                 │   │ 2. Hybrid search     │ │     │
│                                 │   │ 3. LLM generation    │ │     │
│                                 │   │ 4. Cost tracking     │ │     │
│                                 │   └─────────────────────┘ │     │
│                                 └──────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
  Azure OpenAI         Azure AI Search       OpenRouter
  (Embeddings)         (Hybrid Index)        (Mistral Nemo)
```

## Project Structure

```
RAGAzureNode/
├── data/                         # Healthcare regulation .txt files
├── scripts/
│   └── ingest.js                 # Document ingestion: chunk → embed → upload
├── src/
│   ├── index.js                  # Express server, API endpoints, middleware
│   ├── config.js                 # Centralized configuration
│   ├── middleware/
│   │   └── security.js           # Prompt injection detection (10 regex patterns)
│   ├── rag/
│   │   ├── pipeline.js           # RAG pipeline: embed → search → LLM → response
│   │   ├── search.js             # Azure AI Search: index creation, hybrid search
│   │   ├── embeddings.js         # Azure OpenAI embeddings client
│   │   └── llm.js                # OpenRouter LLM client (Mistral Nemo)
│   └── utils/
│       └── costs.js              # Token estimation and cost tracking
├── frontend/
│   ├── app/
│   │   ├── page.js               # Main UI component
│   │   ├── page.module.css       # CSS Modules styles
│   │   ├── layout.js             # Root layout
│   │   └── globals.css           # Base styles
│   ├── Dockerfile                # Multi-stage build (deps → build → standalone)
│   └── package.json
├── Dockerfile                    # Backend container
├── docker-compose.yml            # Local orchestration
└── .env                          # API keys (not committed)
```

## Getting Started

### Prerequisites

- Node.js 20+
- Docker Desktop
- Azure account with:
  - Azure OpenAI resource (text-embedding-3-small deployed)
  - Azure AI Search resource (Free tier works)
- OpenRouter API key

### 1. Clone and install

```bash
git clone https://github.com/yourusername/RAGAzureNode.git
cd RAGAzureNode
npm install
cd frontend && npm install && cd ..
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Azure OpenAI (Embeddings)
AZURE_EMBED_KEY=your-azure-openai-key
AZURE_EMBED_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_EMBED_DEPLOYMENT=text-embedding-3-small

# Azure AI Search
AZURE_SEARCH_ENDPOINT=https://your-search.search.windows.net
AZURE_SEARCH_KEY=your-search-key
AZURE_SEARCH_INDEX=healthcare-regulations
```

### 3. Ingest documents

```bash
npm run ingest
```

This reads the `.txt` files from `data/`, splits them into chunks (500 chars, 100 overlap), generates embeddings, creates the Azure AI Search index, and uploads everything.

### 4. Run locally

**Option A — Without Docker (2 terminals):**

```bash
# Terminal 1: Backend
npm start

# Terminal 2: Frontend
cd frontend && npm run dev
```

**Option B — With Docker (1 command):**

```bash
docker compose up -d
```

Open **http://localhost:3000** in your browser.

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/ask` | Ask a question. Body: `{ "question": "..." }`. Rate limited: 10 req/min |
| `GET` | `/health` | Health check. Returns `{ "status": "ok" }` |
| `GET` | `/stats` | Session cost stats: total tokens, requests, estimated cost |

### Example request

```bash
curl -X POST http://localhost:3001/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "What are the penalties for HIPAA violations?"}'
```

### Example response

```json
{
  "answer": "HIPAA violations can result in civil monetary penalties ranging from $100 to $50,000 per violation, with an annual maximum of $1.5 million per violation category. Criminal penalties can include fines up to $250,000 and imprisonment up to 10 years.",
  "sources": ["hipaa.txt", "hitech.txt"],
  "chunksRetrieved": 4,
  "elapsedMs": 6427,
  "costs": {
    "embedTokens": 11,
    "llmInputTokens": 393,
    "llmOutputTokens": 107,
    "estimatedCostUsd": 0.00001236
  }
}
```

## Security

The system implements 4 layers of protection:

1. **Rate Limiting** — 10 requests/min per IP via `express-rate-limit`
2. **Input Validation** — Type checking, 500 character max length
3. **Prompt Injection Detection** — 10 regex patterns covering common attacks (jailbreak, identity override, instruction injection) + special character ratio analysis
4. **Anti-Hallucination Prompt** — System prompt strictly limits the LLM to only use provided context

## Deployment

The project is deployed on **Azure Container Apps** with the Consumption plan (serverless, scale-to-zero):

```bash
# Build and push to Azure Container Registry
az acr login --name acrragpoc2026
docker compose build
docker tag ragazurenode-backend acrragpoc2026.azurecr.io/rag-backend:v2
docker tag ragazurenode-frontend acrragpoc2026.azurecr.io/rag-frontend:v2
docker push acrragpoc2026.azurecr.io/rag-backend:v2
docker push acrragpoc2026.azurecr.io/rag-frontend:v2
```

Container Apps are configured via Azure Portal with environment variables for API keys.

### Azure Resources

| Resource | Service | Tier |
|----------|---------|------|
| Azure AI Search | Vector + keyword search index | Free (F1) |
| Azure OpenAI | text-embedding-3-small | Pay-as-you-go |
| Azure Container Registry | Docker image storage | Basic |
| Azure Container Apps (x2) | Backend + Frontend hosting | Consumption |

## Cost Analysis

| Component | Cost |
|-----------|------|
| Azure AI Search (Free tier) | $0/mo |
| Embeddings (~$0.02/1M tokens) | ~$0/mo |
| LLM (~$0.00002/query) | ~$0.01/mo |
| Container Registry (Basic) | ~$5/mo |
| Container Apps (scale-to-zero) | $0/mo |
| **Total** | **~$5/mo** |

At $0.00002 per query, you can ask **50,000 questions for $1 USD**.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Search strategy | Hybrid (vector + BM25) | Vector catches semantic similarity; BM25 catches exact regulatory terms like "42 CFR Part 2" |
| LLM | Mistral Nemo via OpenRouter | $0.02/1M tokens — cost-effective for a PoC while maintaining quality |
| Embedding model | text-embedding-3-small (1536 dims) | Best cost/performance ratio for retrieval |
| Frontend framework | Next.js | React ecosystem standard, SSR-capable, standalone Docker output |
| Container orchestration | Docker Compose (local) / Container Apps (prod) | Simple local dev, serverless production |
| Cost tracking | In-memory estimation (~4 chars/token) | Zero dependencies, sufficient for monitoring |
| Prompt injection defense | Regex patterns | Zero cost, zero latency, catches ~80% of common attacks |

## License

ISC
