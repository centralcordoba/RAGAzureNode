/**
 * Express server with POST /ask endpoint.
 * Includes rate limiting, input validation, and cost tracking.
 */
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { query } = require("./rag");
const { validateQuestion } = require("./security");
const { getStats } = require("./costs");
const config = require("./config");

const app = express();
app.use(cors());
app.use(express.json());

// Rate limiting: prevent abuse and control costs
const askLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: config.maxRequestsPerMinute,
  message: {
    error: `Rate limit exceeded. Maximum ${config.maxRequestsPerMinute} requests per minute.`,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Cost stats endpoint
app.get("/stats", (req, res) => {
  res.json(getStats());
});

// RAG endpoint with rate limiting
app.post("/ask", askLimiter, async (req, res) => {
  const { question } = req.body;

  // 1. Validate input exists and is a string
  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'question' field" });
  }

  // 2. Length limit (cost control + injection mitigation)
  if (question.length > config.maxQuestionLength) {
    return res.status(400).json({
      error: `Question too long (max ${config.maxQuestionLength} characters)`,
    });
  }

  // 3. Prompt injection check
  const validation = validateQuestion(question);
  if (!validation.safe) {
    console.warn("[SECURITY]", validation.reason, "| Question:", question.substring(0, 80));
    return res.status(400).json({ error: validation.reason });
  }

  try {
    const result = await query(question);
    res.json(result);
  } catch (err) {
    console.error("[ERROR /ask]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(config.port, () => {
  console.log(`\nRAG server running on http://localhost:${config.port}`);
  console.log(`  POST /ask   - Ask a question`);
  console.log(`  GET /health - Health check`);
  console.log(`  GET /stats  - Cost & usage stats`);
  console.log(`\n  Controls:`);
  console.log(`    Rate limit: ${config.maxRequestsPerMinute} req/min`);
  console.log(`    Max question: ${config.maxQuestionLength} chars`);
  console.log(`    Max output: ${config.maxOutputTokens} tokens`);
  console.log(`    Chat model: ${config.chatModel}`);
});
