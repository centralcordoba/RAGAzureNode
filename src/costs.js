/**
 * Cost tracking module.
 * Estimates and accumulates token usage and costs per request.
 */
const config = require("./config");

// Approximate: 1 token ≈ 4 characters for English text
const CHARS_PER_TOKEN = 4;

// Session-level accumulator (resets on server restart)
const stats = {
  totalRequests: 0,
  totalEmbedTokens: 0,
  totalLlmInputTokens: 0,
  totalLlmOutputTokens: 0,
  totalCostUsd: 0,
  startedAt: new Date().toISOString(),
};

/**
 * Estimate tokens from a string (approximate).
 */
function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Track a single RAG request's cost.
 * Returns the cost breakdown for this request.
 */
function trackRequest({ question, context, answer }) {
  const embedTokens = estimateTokens(question);
  const llmInputTokens = estimateTokens(context + question);
  const llmOutputTokens = estimateTokens(answer);

  const embedCost = (embedTokens / 1_000_000) * config.costPerMillionEmbedTokens;
  const llmInputCost = (llmInputTokens / 1_000_000) * config.costPerMillionInputTokens;
  const llmOutputCost = (llmOutputTokens / 1_000_000) * config.costPerMillionOutputTokens;
  const totalCost = embedCost + llmInputCost + llmOutputCost;

  // Accumulate
  stats.totalRequests++;
  stats.totalEmbedTokens += embedTokens;
  stats.totalLlmInputTokens += llmInputTokens;
  stats.totalLlmOutputTokens += llmOutputTokens;
  stats.totalCostUsd += totalCost;

  return {
    embedTokens,
    llmInputTokens,
    llmOutputTokens,
    estimatedCostUsd: Number(totalCost.toFixed(8)),
  };
}

/**
 * Get accumulated stats for the session.
 */
function getStats() {
  return {
    ...stats,
    totalCostUsd: Number(stats.totalCostUsd.toFixed(6)),
    uptimeSince: stats.startedAt,
  };
}

module.exports = { trackRequest, getStats, estimateTokens };
