# Fase 5 — Dockerización

## Qué construimos

Empaquetamos el backend (Express) y el frontend (Next.js) en contenedores Docker independientes, orquestados con `docker-compose`. Un solo comando levanta todo el sistema.

```
docker compose up
       │
       ├── backend (ragazurenode-backend)
       │   ├── Node 20 Alpine
       │   ├── Express + LangChain + Azure SDKs
       │   ├── Puerto 3001
       │   └── Health check: GET /health
       │
       └── frontend (ragazurenode-frontend)
            ├── Node 20 Alpine (standalone)
            ├── Next.js pre-built
            ├── Puerto 3000
            └── depends_on: backend (healthy)
```

---

## Por qué Docker

| Sin Docker | Con Docker |
|------------|-----------|
| "Funciona en mi máquina" | Funciona igual en cualquier máquina |
| Instalar Node, npm, versiones correctas | Solo necesitas Docker |
| Abrir 2 terminales manualmente | `docker compose up` y listo |
| Configurar variables en cada máquina | `.env` centralizado |
| Difícil de deploy a la nube | Las imágenes se suben directo a Azure Container Registry |

Docker resuelve el problema de **reproducibilidad**: el mismo contenedor que corre en tu laptop corre en Azure, en AWS, o en la máquina del entrevistador.

---

## Archivo por archivo

### `Dockerfile` (backend)

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --legacy-peer-deps

COPY src/ ./src/

EXPOSE 3001

CMD ["node", "src/index.js"]
```

#### Decisiones explicadas

**`node:20-alpine`** en lugar de `node:20`:
- Alpine Linux es una distro minimalista (~5MB base vs ~120MB Debian)
- La imagen final es ~394MB vs ~1.2GB con Debian
- Menos superficie de ataque (menos paquetes instalados = menos CVEs)

**`COPY package.json` antes de `COPY src/`** (layer caching):
```
Si solo cambias código en src/:
  - COPY package.json  → CACHED (no cambió)
  - npm ci             → CACHED (no cambió)
  - COPY src/          → RE-EJECUTA (cambió)

Si también cambias dependencias:
  - COPY package.json  → RE-EJECUTA (cambió)
  - npm ci             → RE-EJECUTA (deps nuevas)
  - COPY src/          → RE-EJECUTA (layer anterior cambió)
```

Esto hace que rebuilds sean rápidos (~2s) cuando solo cambias código, porque `npm ci` (~10s) se cachea.

**`npm ci` vs `npm install`**:
- `npm ci` instala exactamente lo que dice `package-lock.json` (reproducible)
- `npm install` puede actualizar versiones dentro del rango del `^` (no reproducible)
- En CI/CD y Docker siempre se usa `npm ci`

**`--omit=dev`**: No instala devDependencies. En producción no necesitas test runners, linters, etc.

**`--legacy-peer-deps`**: LangChain Community tiene un conflicto de peer dependency con dotenv v17 vs v16. Este flag lo resuelve igual que en desarrollo local.

**No copiamos `.env`**: Las variables de entorno se inyectan vía `docker-compose` (más seguro que tener secrets en la imagen).

### `frontend/Dockerfile` (frontend - multi-stage)

```dockerfile
# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

#### Por qué multi-stage build

Sin multi-stage, la imagen incluiría todo: node_modules de desarrollo, código fuente, archivos de build intermedios. Con 3 stages:

```
Stage deps:     Instala todas las dependencias (~150MB de node_modules)
Stage builder:  Copia deps + código → ejecuta `next build` → genera standalone (~30MB)
Stage runner:   Solo copia el resultado del build (~268MB imagen final)

Lo que NO está en la imagen final:
  ✗ node_modules completo (solo lo necesario está en standalone)
  ✗ Código fuente (.jsx, .css originales)
  ✗ Archivos de build intermedios
  ✗ Dependencias de desarrollo
```

#### `output: "standalone"` en `next.config.mjs`

```javascript
const nextConfig = {
  output: "standalone",
};
```

Esto le dice a Next.js que genere un output auto-contenido en `.next/standalone/`. Incluye:
- `server.js` — servidor HTTP mínimo (no necesita el node_modules completo)
- Solo los módulos de Node.js que realmente se usan (tree-shaking)
- El resultado es ~30MB en lugar de ~150MB

**Sin standalone**, necesitarías copiar todo `node_modules` a la imagen final.

#### `NEXT_PUBLIC_API_URL` como build arg

```dockerfile
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
```

En Next.js, las variables `NEXT_PUBLIC_*` se inyectan **en build time**, no en runtime. Esto significa que el valor se "bake" dentro del JavaScript del browser durante `next build`.

- Default `http://localhost:3001`: funciona para desarrollo local y docker-compose
- Para producción se cambia en build time: `--build-arg NEXT_PUBLIC_API_URL=https://api.miapp.com`

### `.dockerignore` (backend)

```
node_modules
.git
.env
frontend
docs
docs-guide
vectorstore.json
*.md
```

Excluye todo lo que no necesita el backend:
- `node_modules` — se instala dentro del container (`npm ci`)
- `.env` — se inyecta vía docker-compose, no se copia a la imagen
- `frontend` — tiene su propio Dockerfile
- `vectorstore.json` (~2.4MB) — ya no se usa, los datos están en Azure AI Search
- `docs`, `*.md` — documentación, no código

### `frontend/.dockerignore`

```
node_modules
.next
.git
*.md
```

Mismo principio: no copiar lo que se regenera dentro del container.

### `docker-compose.yml`

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    env_file:
      - .env
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3001/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_API_URL: http://localhost:3001
    ports:
      - "3000:3000"
    depends_on:
      backend:
        condition: service_healthy
```

#### `env_file: .env`

En lugar de copiar `.env` dentro de la imagen (inseguro — cualquiera que tenga la imagen puede ver tus secrets), docker-compose lee el archivo `.env` y lo inyecta como variables de entorno al container en runtime.

```
La imagen Docker NO contiene secrets
    ↓
docker-compose lee .env del host
    ↓
Inyecta como variables de entorno al container
    ↓
config.js lee process.env.* normalmente
```

#### Health check

```yaml
healthcheck:
  test: ["CMD", "wget", "-q", "--spider", "http://localhost:3001/health"]
  interval: 10s
  timeout: 5s
  retries: 3
```

- Docker ejecuta `wget` al endpoint `/health` cada 10 segundos
- Si falla 3 veces seguidas, marca el container como `unhealthy`
- Usamos `wget` porque Alpine no incluye `curl` por defecto
- `-q` (quiet) y `--spider` (no descargar, solo verificar) para que no genere output

#### `depends_on` con condition

```yaml
depends_on:
  backend:
    condition: service_healthy
```

El frontend NO arranca hasta que el backend esté `healthy` (health check pasó al menos una vez). Sin `condition: service_healthy`, Docker solo esperaría a que el container backend **inicie**, no a que esté listo para recibir requests.

```
Sin condition:
  backend inicia → frontend inicia inmediatamente → frontend puede fallar si backend aún no está listo

Con service_healthy:
  backend inicia → health check pasa → frontend inicia → backend ya está listo
```

#### Red interna de Docker

Docker Compose crea automáticamente una red (`ragazurenode_default`) donde los servicios se pueden comunicar por nombre:
- El frontend podría hacer `fetch("http://backend:3001/ask")` si fuera server-side
- Pero como el `fetch` corre en el **browser del usuario** (es un componente `"use client"`), usa `localhost:3001`

---

## Comandos Docker esenciales

### Levantar todo

```bash
docker compose up -d
```

- `-d` (detached): corre en background, te devuelve la terminal
- Sin `-d`: muestra los logs en vivo (útil para debugging)

### Ver estado

```bash
docker compose ps
```

Muestra:
```
NAME                      STATUS          PORTS
ragazurenode-backend-1    Up (healthy)    0.0.0.0:3001->3001/tcp
ragazurenode-frontend-1   Up              0.0.0.0:3000->3000/tcp
```

### Ver logs

```bash
docker compose logs backend    # solo backend
docker compose logs frontend   # solo frontend
docker compose logs -f         # todos, en vivo (follow)
```

### Detener todo

```bash
docker compose down
```

Detiene y elimina los containers (pero preserva las imágenes para rebuild rápido).

### Rebuild después de cambios en el código

```bash
docker compose up -d --build
```

`--build` fuerza rebuild de las imágenes. Si solo cambiaste código en `src/`, el rebuild es rápido (~2-3s) gracias al layer caching.

### Ver tamaño de imágenes

```bash
docker images ragazurenode-*
```

```
REPOSITORY              SIZE
ragazurenode-frontend   268MB
ragazurenode-backend    394MB
```

---

## Flujo de desarrollo con Docker

```
1. Editar código en src/ o frontend/app/

2. Rebuild + restart:
   docker compose up -d --build

3. Probar en browser:
   http://localhost:3000

4. Ver logs si algo falla:
   docker compose logs -f

5. Cuando terminas:
   docker compose down
```

---

## Concepto: Container Registry (preparación para Azure)

Para hacer deploy a Azure Container Apps, necesitamos subir las imágenes a un **Container Registry** — un repositorio de imágenes Docker en la nube.

```
Desarrollo local                          Azure
┌──────────────┐    docker push    ┌─────────────────────┐
│  Tu máquina  │ ────────────────> │  Azure Container    │
│  docker build│                   │  Registry (ACR)     │
└──────────────┘                   │  miregistry.azurecr │
                                   └─────────┬───────────┘
                                             │ pull
                                   ┌─────────▼───────────┐
                                   │  Azure Container    │
                                   │  Apps               │
                                   │  (ejecuta los       │
                                   │   containers)       │
                                   └─────────────────────┘
```

### Opciones de Container Registry

| Registry | Cuándo usarlo | Costo |
|----------|---------------|-------|
| **Azure Container Registry (ACR)** | Si deploy es en Azure (nuestro caso) | ~$5/mes (Basic) |
| **Docker Hub** | Open source, imágenes públicas | Gratis (públicas), $5/mes (privadas) |
| **GitHub Container Registry (ghcr.io)** | Si el repo está en GitHub | Gratis para repos públicos |
| **AWS ECR** | Si deploy es en AWS | ~$0.10/GB/mes |

Para este proyecto usaremos **ACR** porque todo nuestro stack está en Azure.

---

## Costos de deploy en Azure — Análisis completo

### Todos los servicios que usa nuestro RAG en Azure

```
┌─────────────────────────────────────────────────────────────────┐
│  SERVICIO                       │  TIER         │  COSTO/MES   │
├─────────────────────────────────┼───────────────┼──────────────┤
│  Azure AI Search                │  Free (F1)    │  $0.00       │
│  Azure OpenAI (embeddings)      │  Pay-as-you-go│  ~$0.01      │
│  OpenRouter / Mistral Nemo (LLM)│  Pay-as-you-go│  ~$0.01      │
│  Azure Container Registry (ACR) │  Basic        │  ~$5.00      │
│  Azure Container Apps (backend) │  Consumption  │  $0 - $17    │
│  Azure Container Apps (frontend)│  Consumption  │  $0 - $17    │
├─────────────────────────────────┼───────────────┼──────────────┤
│  TOTAL ESTIMADO                 │               │  $5 - $39/mes│
└─────────────────────────────────┴───────────────┴──────────────┘
```

### Desglose servicio por servicio

#### 1. Azure AI Search — $0/mes (Free tier)

| Concepto | Valor |
|----------|-------|
| Tier | Free (F1) |
| Almacenamiento | 50 MB incluidos (usamos ~2MB) |
| Índices | 3 máximo (usamos 1) |
| Costo | **$0.00** |

El Free tier tiene limitaciones (sin semantic ranking, sin managed identities), pero es más que suficiente para nuestro PoC con un solo índice pequeño.

**Siguiente tier (Basic):** ~$75/mes. Solo necesario si superas 50MB o necesitas más de 3 índices.

#### 2. Azure OpenAI — Embeddings — ~$0.01/mes

| Concepto | Valor |
|----------|-------|
| Modelo | text-embedding-3-small |
| Precio | $0.02 por 1 millón de tokens |
| Uso estimado (500 preguntas/mes) | ~6,250 tokens embed |
| Costo | **~$0.000125** (básicamente $0) |

A $0.02 por millón de tokens, necesitarías hacer **50 millones de embeddings** para gastar $1. El costo de embeddings es despreciable.

#### 3. OpenRouter / Mistral Nemo — LLM — ~$0.01/mes

| Concepto | Valor |
|----------|-------|
| Modelo | Mistral Nemo (mistralai/mistral-nemo) |
| Precio input | $0.02 por 1 millón de tokens |
| Precio output | $0.04 por 1 millón de tokens |
| Costo por pregunta | ~$0.00002 |
| Uso estimado (500 preguntas/mes) | **~$0.01** |

A ~$0.00002 por pregunta, puedes hacer **50,000 preguntas por $1 USD**.

#### 4. Azure Container Registry (ACR) — ~$5/mes

| Concepto | Valor |
|----------|-------|
| Tier | Basic |
| Almacenamiento incluido | 10 GB |
| Nuestras imágenes | ~662 MB (backend 394MB + frontend 268MB) |
| Precio base | $0.167/día = **~$5.00/mes** |

El Basic tier incluye 10GB de storage — más que suficiente para nuestras 2 imágenes. Si necesitas más storage, son $0.003/día por GB adicional.

#### 5. Azure Container Apps — $0 a $34/mes (según uso)

Este es el servicio más variable. El costo depende de si los containers están corriendo 24/7 o si usan **scale-to-zero**.

**Precios del Consumption Plan (aproximados, East US):**

| Meter | Precio | Free grant mensual |
|-------|--------|--------------------|
| vCPU (activo) | ~$0.000024/vCPU-segundo | 180,000 vCPU-segundos |
| Memoria (activo) | ~$0.000003/GiB-segundo | 360,000 GiB-segundos |
| Requests HTTP | $0.40/millón | 2 millones |

**Free grants equivalen a:**
```
180,000 vCPU-s ÷ 3600 = 50 horas de 1 vCPU
360,000 GiB-s ÷ 3600 = 100 horas de 1 GiB
2M requests = mucho más de lo que necesita un PoC
```

##### Escenario A: Scale-to-zero (PoC / demo) — ~$0/mes

```
Configuración:
  - min replicas: 0 (scale to zero cuando no hay tráfico)
  - max replicas: 1
  - Cada container: 0.25 vCPU, 0.5 GiB

Uso real: ~2 horas/día de actividad (demos, testing)

Backend:
  vCPU:  0.25 × 7200s × 30 días = 54,000 vCPU-s
  GiB:   0.5  × 7200s × 30 días = 108,000 GiB-s

Frontend:
  vCPU:  0.25 × 7200s × 30 días = 54,000 vCPU-s
  GiB:   0.5  × 7200s × 30 días = 108,000 GiB-s

TOTAL:
  vCPU:  108,000 vCPU-s  (< 180,000 free grant) → $0.00
  GiB:   216,000 GiB-s   (< 360,000 free grant) → $0.00
  Requests: ~500/mes      (< 2M free grant)      → $0.00

  Container Apps total: $0.00 ✓
```

**Con scale-to-zero y uso bajo, Container Apps es efectivamente gratis.**

##### Escenario B: Always-on (24/7, min replicas = 1) — ~$34/mes

```
Configuración:
  - min replicas: 1 (siempre corriendo)
  - Cada container: 0.25 vCPU, 0.5 GiB

Backend (24/7):
  vCPU:  0.25 × 86400s × 30 = 648,000 vCPU-s
  GiB:   0.5  × 86400s × 30 = 1,296,000 GiB-s

Frontend (24/7):
  vCPU:  0.25 × 86400s × 30 = 648,000 vCPU-s
  GiB:   0.5  × 86400s × 30 = 1,296,000 GiB-s

TOTAL:
  vCPU:  1,296,000 - 180,000 free = 1,116,000 billable
         1,116,000 × $0.000024 = $26.78
  GiB:   2,592,000 - 360,000 free = 2,232,000 billable
         2,232,000 × $0.000003 = $6.70

  Container Apps total: ~$33.48/mes
```

### Resumen de costos totales

| Escenario | AI Search | Embeddings | LLM | ACR | Container Apps | **TOTAL** |
|-----------|-----------|-----------|-----|-----|---------------|-----------|
| **Scale-to-zero (PoC)** | $0 | ~$0 | ~$0.01 | $5 | $0 | **~$5/mes** |
| **Always-on (demo 24/7)** | $0 | ~$0 | ~$0.01 | $5 | ~$34 | **~$39/mes** |
| **Sin ACR (usar GitHub CR)** | $0 | ~$0 | ~$0.01 | $0 | $0 | **~$0/mes** |

### Cómo minimizar costos

1. **Scale-to-zero:** Configurar `minReplicas: 0` en Container Apps. El container se apaga cuando no hay tráfico y se enciende cuando llega un request (~2-5s de cold start).

2. **Usar GitHub Container Registry** en lugar de ACR: Si el repo está en GitHub (público), ghcr.io es gratis. Esto elimina los $5/mes de ACR.

3. **Free tier de Azure AI Search:** Ya lo estamos usando. $0.

4. **Mistral Nemo vía OpenRouter:** Es uno de los LLMs más baratos disponibles. $0.00002 por pregunta.

5. **Apagar cuando no uses:** `az containerapp update --min-replicas 0` o simplemente no enviar tráfico (scale-to-zero lo maneja automáticamente).

### Comparación con alternativas de hosting

| Plataforma | Costo mínimo | Incluye |
|------------|-------------|---------|
| **Azure Container Apps (scale-to-zero)** | ~$5/mes (ACR) | Serverless, auto-scale, HTTPS gratis |
| **Azure App Service (F1 free)** | $0/mes | 1GB RAM, 60min CPU/día, sin custom domain HTTPS |
| **Railway** | $5/mes | Incluye hosting + builds, simple |
| **Render** | $0-7/mes | Free tier con spin-down, $7 para always-on |
| **Vercel + Railway** | $0-5/mes | Vercel free para frontend, Railway para backend |
| **AWS ECS Fargate** | ~$30/mes | Similar a Container Apps pero más complejo |
| **DigitalOcean App Platform** | $5/mes | Simpler que Azure, buen DX |

### Qué decir en una entrevista sobre costos

> "El sistema completo corre por ~$5/mes en Azure usando Container Apps con scale-to-zero. El costo dominante es Azure Container Registry ($5/mes Basic); el compute es efectivamente gratis para un PoC gracias a los free grants de 180K vCPU-seconds. Los costos de API (embeddings + LLM) son ~$0.00002 por pregunta — podemos hacer 50,000 preguntas por $1. Si necesitamos 24/7 availability, el costo sube a ~$39/mes, pero para un MVP con tráfico bajo, scale-to-zero es la opción correcta. Como optimización adicional, podríamos usar GitHub Container Registry (gratis) en lugar de ACR, reduciendo el costo total a prácticamente $0."

---

## Archivos creados/modificados en esta fase

| Archivo | Acción | Qué hace |
|---------|--------|----------|
| `Dockerfile` | **Creado** | Build del backend Express (Node 20 Alpine, layer caching) |
| `frontend/Dockerfile` | **Creado** | Build multi-stage del frontend Next.js (deps → build → standalone) |
| `.dockerignore` | **Creado** | Excluye node_modules, .env, frontend, docs del build del backend |
| `frontend/.dockerignore` | **Creado** | Excluye node_modules, .next del build del frontend |
| `docker-compose.yml` | **Creado** | Orquesta backend + frontend con health check y env_file |
| `frontend/next.config.mjs` | **Modificado** | Agregado `output: "standalone"` para builds Docker optimizados |

---

## Resumen de decisiones técnicas

| Decisión | Qué elegimos | Por qué | Alternativa |
|----------|-------------|---------|-------------|
| Base image | Node 20 Alpine | Pequeña (~130MB base), segura | Node 20 Debian (~350MB base) |
| Build strategy frontend | Multi-stage (3 stages) | Imagen final mínima (268MB) | Single stage (~800MB+) |
| Next.js output | standalone | Elimina node_modules del runtime | default (requiere todo node_modules) |
| Secrets | env_file en docker-compose | Secrets fuera de la imagen | COPY .env (inseguro) |
| Orquestación | docker-compose | Un comando para todo | Scripts bash separados |
| Health check | wget a /health | Alpine no tiene curl, reutiliza endpoint existente | Instalar curl (agrega tamaño) |
| Dependency order | depends_on + service_healthy | Frontend espera que backend esté listo | Sin depends_on (race condition) |
