# Comandos Azure - Setup del RAG PoC

## Pre-requisito

Todos los comandos se ejecutaron desde **Azure Cloud Shell** (https://shell.azure.com), que ya tiene `az` preinstalado. No requiere instalación local.

---

## 1. Crear Resource Group

```bash
az group create --name rg-rag-poc --location eastus2
```

**Qué hace:** Crea un contenedor lógico donde vivirán todos los recursos Azure del proyecto. Elegimos `eastus2` porque tiene disponibilidad de Azure OpenAI y costos competitivos.

**Por qué primero:** Todo recurso Azure necesita pertenecer a un Resource Group. Al tenerlos todos en uno solo, al final podemos borrar el grupo completo y se elimina todo de un golpe.

---

## 2. Registrar el proveedor de Cognitive Services

```bash
az provider register --namespace Microsoft.CognitiveServices
```

**Qué hace:** Habilita el namespace `Microsoft.CognitiveServices` en la suscripción. Las suscripciones nuevas no tienen todos los proveedores registrados por defecto.

**Verificar que completó:**

```bash
az provider show --namespace Microsoft.CognitiveServices --query "registrationState"
# Debe devolver: "Registered"
```

---

## 3. Crear recurso Azure OpenAI

```bash
az cognitiveservices account create \
  --name openai-rag-poc-em2026 \
  --resource-group rg-rag-poc \
  --location eastus2 \
  --kind OpenAI \
  --sku S0 \
  --custom-domain openai-rag-poc-em2026
```

| Parámetro | Valor | Explicación |
|-----------|-------|-------------|
| `--name` | openai-rag-poc-em2026 | Nombre único del recurso |
| `--kind` | OpenAI | Tipo de servicio cognitivo |
| `--sku` | S0 | Tier estándar (pago por uso, sin compromiso) |
| `--custom-domain` | openai-rag-poc-em2026 | Subdominio para el endpoint HTTPS |

**Resultado:** Endpoint generado → `https://openai-rag-poc-em2026.openai.azure.com/`

---

## 4. Desplegar modelo de embeddings

```bash
az cognitiveservices account deployment create \
  --name openai-rag-poc-em2026 \
  --resource-group rg-rag-poc \
  --deployment-name text-embedding-3-small \
  --model-name text-embedding-3-small \
  --model-version "1" \
  --model-format OpenAI \
  --sku-name Standard \
  --sku-capacity 120
```

| Parámetro | Valor | Explicación |
|-----------|-------|-------------|
| `--deployment-name` | text-embedding-3-small | Nombre con el que llamaremos al modelo desde código |
| `--model-name` | text-embedding-3-small | Modelo de OpenAI a desplegar |
| `--sku-capacity` | 120 | Miles de tokens por minuto (120K TPM) |

**Por qué text-embedding-3-small:**
- Costo: ~$0.02 por 1M tokens (el más barato de Azure OpenAI)
- Genera vectores de 1536 dimensiones
- Suficiente calidad para un PoC de regulaciones healthcare

---

## 5. Obtener API keys

```bash
az cognitiveservices account keys list \
  --name openai-rag-poc-em2026 \
  --resource-group rg-rag-poc
```

**Devuelve:** Dos keys (key1 y key2). Usamos key1 en el `.env` del proyecto. Azure genera dos keys para permitir rotación sin downtime.

---

## 6. Crear Azure AI Search (Fase 2)

```bash
az search service create \
  --name search-rag-poc-em2026 \
  --resource-group rg-rag-poc \
  --location eastus2 \
  --sku free
```

| Parámetro | Valor | Explicación |
|-----------|-------|-------------|
| `--name` | search-rag-poc-em2026 | Nombre único del servicio de búsqueda |
| `--sku` | free | Plan gratuito (1 índice, 50MB, 3 índices máximo) |
| `--location` | eastus2 | Misma región que Azure OpenAI para minimizar latencia |

**Qué es Azure AI Search:** Un servicio administrado de búsqueda que soporta búsqueda por keywords (BM25), búsqueda vectorial (similaridad coseno), y búsqueda híbrida (ambas combinadas). Funciona como una base de datos especializada para buscar información.

**Resultado:** Endpoint generado → `https://search-rag-poc-em2026.search.windows.net`

**Planes disponibles:**

| Plan | Costo | Límites | Uso |
|------|-------|---------|-----|
| Free | $0 | 50MB, 3 índices, sin escalado | PoC, desarrollo |
| Basic | ~$0.33/día (~$10/mes) | 2GB, 15 índices | Proyectos pequeños |
| Standard | ~$8.14/día | 25GB+, 50+ índices | Producción |

---

## 7. Obtener API key de Azure AI Search

```bash
az search admin-key show \
  --service-name search-rag-poc-em2026 \
  --resource-group rg-rag-poc
```

**Devuelve:** Dos keys (primaryKey y secondaryKey). Usamos primaryKey en el `.env`. Son admin keys con permisos completos (crear índices, subir documentos, buscar).

**Nota de seguridad:** En producción se usarían query keys (solo lectura) para las búsquedas y admin keys solo para la ingesta:

```bash
# Crear una query key (solo búsqueda, no puede modificar el índice)
az search query-key create \
  --service-name search-rag-poc-em2026 \
  --resource-group rg-rag-poc \
  --name "query-key-app"
```

---

## Limpieza total (cuando termines el PoC)

```bash
az group delete --name rg-rag-poc --yes --no-wait
```

**Qué hace:** Elimina el Resource Group y TODOS los recursos dentro de él. El flag `--no-wait` evita esperar a que termine (puede tomar minutos).

---

## Costo estimado

| Recurso | Costo |
|---------|-------|
| Resource Group | $0 (es solo un contenedor lógico) |
| Azure OpenAI (S0) | $0 base + pago por uso |
| text-embedding-3-small | ~$0.02 por 1M tokens |
| Azure AI Search (Free) | $0 |
| **Total estimado para PoC** | **< $0.50** |
