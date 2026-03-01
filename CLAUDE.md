# CLAUDE.md

## Project Overview

Healthcare Regulatory Compliance RAG system. Node.js backend (Express + LangChain) with Next.js frontend, deployed on Azure Container Apps.

## Architecture

- **Backend** (`src/`): Express API on port 3001. RAG pipeline: embed question → hybrid search Azure AI Search → LLM answer via OpenRouter.
- **Frontend** (`frontend/`): Next.js 16 + React 19 on port 3000. Single page app, `"use client"` component.
- **Deployment**: Docker containers on Azure Container Apps (Consumption plan, scale-to-zero).

## Key Files

| File | Purpose |
|------|---------|
| `src/index.js` | Express server, endpoints `/ask`, `/health`, `/stats`, rate limiting, input validation |
| `src/rag/pipeline.js` | RAG pipeline orchestration: embed → search → LLM → cost tracking |
| `src/rag/search.js` | Azure AI Search client: index creation, hybrid search (vector + BM25) |
| `src/rag/embeddings.js` | Azure OpenAI embeddings (text-embedding-3-small, 1536 dims) |
| `src/rag/llm.js` | ChatOpenAI via OpenRouter (Mistral Nemo) |
| `src/config.js` | All configuration. Env vars use fallback pattern: `EMBED_KEY \|\| AZURE_EMBED_KEY` |
| `src/middleware/security.js` | 10 regex patterns for prompt injection detection |
| `src/utils/costs.js` | Token estimation (~4 chars/token) and cost accumulator |
| `scripts/ingest.js` | Document ingestion: read .txt → chunk (500/100) → embed → upload to Azure AI Search |
| `frontend/app/page.js` | Main UI: question input, example questions, answer card with sources and metrics |

## Commands

```bash
npm start              # Start backend (port 3001)
npm run ingest         # Ingest data/ into Azure AI Search
cd frontend && npm run dev   # Start frontend dev server (port 3000)
docker compose up -d   # Start both via Docker
docker compose down    # Stop both
```

## Environment Variables

Local `.env` uses `AZURE_` prefix. Azure Container Apps blocks that prefix, so `config.js` accepts both:

```
AZURE_EMBED_KEY / EMBED_KEY
AZURE_EMBED_ENDPOINT / EMBED_ENDPOINT
AZURE_EMBED_DEPLOYMENT / EMBED_DEPLOYMENT
AZURE_SEARCH_ENDPOINT / SEARCH_ENDPOINT
AZURE_SEARCH_KEY / SEARCH_KEY
AZURE_SEARCH_INDEX / SEARCH_INDEX
OPENROUTER_API_KEY (same in both environments)
```

## Conventions

- No TypeScript — project is plain JavaScript (CommonJS `require`)
- No Tailwind — CSS Modules for frontend (`page.module.css`)
- No test framework yet — manual testing via curl and browser
- Documentation in Spanish in `docs-guide/` (learning notes), README in English
- All config centralized in `src/config.js` — never hardcode values in other files
- Secrets are NEVER committed. `.env` is in `.gitignore`

## Azure Resources (rg-rag-poc)

| Resource | Name | Region |
|----------|------|--------|
| AI Search | search-rag-poc-em2026 | East US 2 |
| OpenAI | openai-rag-poc-em2026 | East US 2 |
| Container Registry | acrragpoc2026 | East US 2 |
| Container Apps Env | managedEnvironment-rgragpoc-9fda | West US 2 |
| Container App (backend) | ragbackend | West US 2 |
| Container App (frontend) | ragfrontend | West US 2 |

## Docker

- Backend Dockerfile at root: `node:20-alpine`, `npm ci --omit=dev --legacy-peer-deps`
- Frontend Dockerfile at `frontend/`: multi-stage (deps → build → standalone)
- `NEXT_PUBLIC_API_URL` is baked at build time. Local default: `http://localhost:3001`. Production: pass via `--build-arg`
- After code changes: rebuild image, tag with new version, push to ACR, update Container App image tag in portal

## Important Gotchas

- `--legacy-peer-deps` required for npm ci (LangChain Community peer dep conflict with dotenv v17)
- Azure Container Apps blocks env var names starting with `AZURE_`, `MICROSOFT_`, `WINDOWS_`
- Next.js `NEXT_PUBLIC_*` vars are injected at build time, not runtime — changing the backend URL requires a frontend rebuild
- Frontend fetch runs in the browser (component is `"use client"`), so it uses the public backend URL, not Docker internal networking
