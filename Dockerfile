# Backend: Express + LangChain RAG API
FROM node:20-alpine

WORKDIR /app

# Copy dependency files first (layer caching)
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev --legacy-peer-deps

# Copy source code
COPY src/ ./src/

EXPOSE 3001

CMD ["node", "src/index.js"]
