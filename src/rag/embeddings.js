/**
 * Embeddings module.
 * Uses Azure OpenAI with text-embedding-3-small.
 *
 * WHY Azure OpenAI for embeddings?
 * - OpenRouter does not support embedding models
 * - Azure OpenAI keeps data within Azure ecosystem (important for healthcare)
 * - text-embedding-3-small: best cost/performance ratio ($0.02/1M tokens)
 * - Same infrastructure we'll use for Azure AI Search in Phase 2
 */
const { AzureOpenAIEmbeddings } = require("@langchain/openai");
const config = require("../config");

function getEmbeddings() {
  return new AzureOpenAIEmbeddings({
    azureOpenAIApiKey: config.azureEmbedKey,
    azureOpenAIApiInstanceName: "openai-rag-poc-em2026",
    azureOpenAIApiDeploymentName: config.azureEmbedDeployment,
    azureOpenAIApiVersion: "2024-06-01",
  });
}

module.exports = { getEmbeddings };
