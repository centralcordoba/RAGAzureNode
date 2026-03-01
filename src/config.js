require("dotenv").config();

const config = {
  // OpenRouter settings
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  openRouterBaseUrl: "https://openrouter.ai/api/v1",

  // Azure OpenAI (Embeddings) - custom prefix to avoid LangChain auto-detection
  azureEmbedKey: process.env.AZURE_EMBED_KEY,
  azureEmbedEndpoint: process.env.AZURE_EMBED_ENDPOINT,
  azureEmbedDeployment: process.env.AZURE_EMBED_DEPLOYMENT,

  // OpenRouter (Chat LLM) - free model to minimize cost
  chatModel: "mistralai/mistral-nemo",

  // Azure AI Search
  azureSearchEndpoint: process.env.AZURE_SEARCH_ENDPOINT,
  azureSearchKey: process.env.AZURE_SEARCH_KEY,
  azureSearchIndex: process.env.AZURE_SEARCH_INDEX || "healthcare-regulations",

  // RAG settings
  chunkSize: 500,       // characters per chunk
  chunkOverlap: 100,    // overlap between chunks to preserve context
  topK: 4,              // number of chunks to retrieve

  // Cost control
  maxOutputTokens: 512,       // limit LLM response length
  maxQuestionLength: 500,     // max characters in a question
  maxRequestsPerMinute: 10,   // rate limit per IP

  // Cost tracking (approximate prices per 1M tokens)
  costPerMillionEmbedTokens: 0.02,   // Azure OpenAI text-embedding-3-small
  costPerMillionInputTokens: 0.02,   // Mistral Nemo input via OpenRouter
  costPerMillionOutputTokens: 0.04,  // Mistral Nemo output via OpenRouter

  // Server
  port: process.env.PORT || 3001,
};

module.exports = config;
