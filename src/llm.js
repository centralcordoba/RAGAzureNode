/**
 * LLM module.
 * Configures the chat model via OpenRouter with cost controls.
 */
const { ChatOpenAI } = require("@langchain/openai");
const config = require("./config");

/**
 * Returns a ChatOpenAI instance pointed at OpenRouter.
 *
 * Key settings:
 * - maxTokens: limits response length (cost control)
 * - temperature 0.1: near-deterministic for factual Q&A
 */
function getChatModel() {
  return new ChatOpenAI({
    openAIApiKey: config.openRouterApiKey,
    model: config.chatModel,
    maxTokens: config.maxOutputTokens,
    temperature: 0.1,
    configuration: {
      baseURL: config.openRouterBaseUrl,
      defaultHeaders: {
        "HTTP-Referer": "http://localhost:3001",
      },
    },
  });
}

module.exports = { getChatModel };
