# Fase 3 — Frontend con Next.js + React

## Qué construimos

Una interfaz web simple pero profesional que se conecta al backend RAG para hacer preguntas sobre regulaciones healthcare de EEUU.

```
┌─────────────────────────────────────────────────┐
│       Healthcare Regulatory Compliance           │
│  AI-powered assistant for HIPAA, HITECH, ...     │
│                                                  │
│  ┌──────────────────────────────────┐ ┌───────┐ │
│  │ Ask a question about healthcare… │ │  Ask  │ │
│  └──────────────────────────────────┘ └───────┘ │
│                                                  │
│  Try one of these questions:                     │
│  ┌────────────────────────────────────────────┐  │
│  │ What are the penalties for HIPAA violations│  │
│  │ How does 42 CFR Part 2 differ from HIPAA…  │  │
│  │ Which states have stricter privacy laws…   │  │
│  │ What are the FDA 21 CFR Part 11 require…   │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │ ANSWER                                     │  │
│  │ HIPAA violations can result in civil       │  │
│  │ monetary penalties ranging from $100...    │  │
│  │                                            │  │
│  │ [hipaa.txt] [hitech.txt]                   │  │
│  │                                            │  │
│  │ Chunks: 4        Time: 6.3s               │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Arquitectura Frontend ↔ Backend

```
Browser (localhost:3000)              Backend (localhost:3001)
┌───────────────┐                    ┌───────────────────┐
│               │  POST /ask         │                   │
│   Next.js     │ ──────────────────>│   Express         │
│   React       │  {question: "..."}│                   │
│               │                    │   ↓ Azure Search  │
│               │  JSON response     │   ↓ OpenRouter    │
│               │ <──────────────────│                   │
│               │  {answer, sources} │                   │
└───────────────┘                    └───────────────────┘
     Puerto 3000                          Puerto 3001
```

**Son dos servidores separados:**
- **Frontend (Next.js):** Sirve la UI, corre en puerto 3000
- **Backend (Express):** Sirve la API, corre en puerto 3001

El frontend hace un `fetch()` al backend cuando el usuario hace una pregunta. El backend procesa con Azure AI Search + LLM y devuelve la respuesta.

## Por qué Next.js

| Alternativa | Por qué no |
|-------------|-----------|
| React puro (create-react-app) | CRA está deprecado. Next.js es el estándar actual de React |
| Vite + React | Válido, pero Next.js nos da SSR y API routes gratis para Fase 5 |
| HTML + vanilla JS | Funcional pero no escala. No demuestra competencia con frameworks modernos |

**Next.js** es la elección porque:
- Es el framework recomendado oficialmente por React
- Tiene Server-Side Rendering (útil para SEO si esto se vuelve público)
- Tiene API routes (podríamos mover el backend dentro de Next.js en el futuro)
- Es lo que un entrevistador esperaría ver en un proyecto full-stack moderno

## Estructura de archivos

```
frontend/
├── app/
│   ├── globals.css        ← Estilos globales (reset, body, fonts)
│   ├── layout.js          ← Layout raíz (HTML shell, metadata)
│   ├── page.js            ← Página principal (toda la UI)
│   ├── page.module.css    ← Estilos de la página (CSS Modules)
│   └── favicon.ico        ← Ícono del tab del browser
├── package.json
└── node_modules/
```

**Solo 4 archivos de código.** Esa es la ventaja de mantenerlo simple para un PoC.

## Explicación de cada archivo

### `layout.js` — El esqueleto HTML

```jsx
import "./globals.css";

export const metadata = {
  title: "Healthcare RAG - Regulatory Compliance",
  description: "AI-powered healthcare regulatory compliance assistant",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- Define el `<html>` y `<body>` de toda la app
- `metadata` genera automáticamente las tags `<title>` y `<meta description>`
- `{children}` es donde Next.js renderiza el contenido de cada página
- Importa `globals.css` para que aplique a toda la app

### `globals.css` — Reset y base

```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #f0f2f5;
  color: #1a1a2e;
  line-height: 1.6;
}
```

- Reset mínimo (no framework CSS, no Tailwind)
- Font del sistema (se ve nativo en cada OS)
- Background gris claro profesional

### `page.js` — El componente principal

Este es el archivo más importante. Contiene toda la lógica de la UI.

#### Directiva `"use client"`

```jsx
"use client";
```

Next.js por defecto renderiza componentes en el servidor. Como necesitamos `useState` y `fetch` (interactividad del browser), le decimos que este componente corre en el cliente.

#### Configuración de la API

```jsx
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
```

- En desarrollo: apunta a `localhost:3001` (nuestro backend Express)
- En producción: se configura via variable de entorno `NEXT_PUBLIC_API_URL`
- El prefijo `NEXT_PUBLIC_` es requerido por Next.js para exponer variables al browser

#### Estado del componente

```jsx
const [question, setQuestion] = useState("");    // texto del input
const [result, setResult] = useState(null);      // respuesta del backend
const [loading, setLoading] = useState(false);   // spinner de carga
const [error, setError] = useState(null);        // mensaje de error
```

4 estados que controlan toda la UI:

```
Estado inicial:     question="" , result=null , loading=false , error=null
  → Muestra: input vacío + preguntas de ejemplo

Mientras busca:     question="..." , result=null , loading=true , error=null
  → Muestra: input deshabilitado + spinner

Respuesta exitosa:  question="..." , result={...} , loading=false , error=null
  → Muestra: tarjeta con respuesta + fuentes + métricas

Error:              question="..." , result=null , loading=false , error="msg"
  → Muestra: banner rojo con mensaje de error
```

#### Función de envío

```jsx
async function handleSubmit(e) {
  e.preventDefault();                    // Evita reload de la página
  if (!question.trim() || loading) return; // Validación básica

  setLoading(true);                      // Muestra spinner
  setError(null);                        // Limpia errores previos
  setResult(null);                       // Limpia resultado previo

  try {
    const res = await fetch(`${API_URL}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: question.trim() }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Server error");
    }

    const data = await res.json();
    setResult(data);                     // Muestra la respuesta
  } catch (err) {
    setError(err.message);               // Muestra el error
  } finally {
    setLoading(false);                   // Oculta spinner siempre
  }
}
```

**Flujo:**
1. Usuario hace click en "Ask" o presiona Enter
2. Se previene el reload del form
3. Se activa el estado de loading
4. Se hace `fetch` POST al backend con la pregunta
5. Si el backend responde ok → se muestra la respuesta
6. Si falla → se muestra el error
7. En cualquier caso → se desactiva el loading

#### Preguntas de ejemplo

```jsx
const EXAMPLES = [
  "What are the penalties for HIPAA violations?",
  "How does 42 CFR Part 2 differ from HIPAA regarding patient consent?",
  "Which states have stricter privacy laws than HIPAA?",
  "What are the FDA 21 CFR Part 11 requirements for audit trails?",
];
```

- Se muestran solo cuando no hay resultado ni loading
- Click en una → rellena el input con esa pregunta
- Mejoran la UX: el usuario no tiene que inventar qué preguntar
- Cubren las 4 regulaciones principales de nuestra base de datos

#### Renderizado condicional

La UI muestra diferentes cosas según el estado:

```
┌─ Siempre visible ────────────────────────────┐
│  Header (título + subtítulo)                  │
│  Form (input + botón)                         │
├──────────────────────────────────────────────┤
│  SI no hay resultado ni loading ni error:     │
│    → Preguntas de ejemplo                     │
│                                               │
│  SI loading=true:                             │
│    → Spinner + "Searching regulations..."     │
│                                               │
│  SI error:                                    │
│    → Banner rojo con mensaje                  │
│                                               │
│  SI result:                                   │
│    → Tarjeta con respuesta                    │
│    → Tags de fuentes (hipaa.txt, etc.)        │
│    → Métricas (chunks, tiempo)                │
└──────────────────────────────────────────────┘
```

### `page.module.css` — Estilos con CSS Modules

Next.js usa **CSS Modules** por defecto. Cada clase se convierte en un nombre único para evitar colisiones:

```jsx
// En el código
<div className={styles.container}>

// En el HTML renderizado
<div class="page-module__wtSYKa__container">
```

**Decisiones de diseño:**

| Elemento | Decisión | Por qué |
|----------|----------|---------|
| Max-width: 800px | Limita el ancho | Texto largo es difícil de leer en pantallas anchas |
| Background #f0f2f5 | Gris claro | Profesional, descansa la vista, contraste con tarjetas blancas |
| Border-radius: 8-12px | Bordes redondeados | Estándar moderno, se ve profesional |
| Spinner CSS puro | Sin librería | Menos dependencias, animación simple con `@keyframes` |
| Source tags azules | Pills/badges | Patrón común para mostrar categorías/tags |

## CORS: por qué fue necesario

Cuando el frontend (localhost:3000) hace fetch al backend (localhost:3001), el browser bloquea el request por **CORS** (Cross-Origin Resource Sharing). Son dominios diferentes (distinto puerto = distinto origen).

**Solución:** Agregamos `cors` al backend:

```js
const cors = require("cors");
app.use(cors());  // Permite requests desde cualquier origen
```

En producción esto se restringiría al dominio del frontend:

```js
app.use(cors({ origin: "https://mi-app.azurecontainerapps.io" }));
```

## Dependencia agregada al backend

```bash
npm install cors
```

Middleware Express que agrega los headers `Access-Control-Allow-Origin` necesarios para que el browser permita requests cross-origin.

## Cómo levantar el proyecto

Se necesitan **2 terminales** en VS Code:

### Terminal 1 — Backend

```bash
cd C:\repositories\RAGAzureNode
npm start
```

### Terminal 2 — Frontend

```bash
cd C:\repositories\RAGAzureNode\frontend
npm run dev
```

### Abrir en browser

**http://localhost:3000**

### Detener

`Ctrl + C` en cada terminal.

**Orden:** Siempre levantar el backend primero. El frontend necesita que el backend esté en el puerto 3001 para responder preguntas.

## Error común: "Unable to acquire lock"

Si al levantar el frontend dice:

```
⨯ Unable to acquire lock at .next/dev/lock
```

Significa que hay un proceso anterior de Next.js que no se cerró bien. Solución:

```bash
rd /s /q C:\repositories\RAGAzureNode\frontend\.next
npm run dev
```

Esto borra la cache de desarrollo y reinicia limpio.

## Resumen de archivos tocados en esta fase

| Archivo | Acción | Qué hace |
|---------|--------|----------|
| `frontend/app/layout.js` | Modificado | Layout raíz con metadata del proyecto |
| `frontend/app/page.js` | Modificado | Toda la UI: input, preguntas ejemplo, respuesta, fuentes |
| `frontend/app/globals.css` | Modificado | Reset CSS y estilos base |
| `frontend/app/page.module.css` | Modificado | Todos los estilos de la página |
| `src/index.js` (backend) | Modificado | Agregado CORS para permitir requests del frontend |
| `package.json` (backend) | Modificado | Agregada dependencia `cors` |
