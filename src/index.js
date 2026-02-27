/**
 * Express server with POST /ask endpoint.
 */
const express = require("express");
const { query } = require("./rag");
const config = require("./config");

const app = express();
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// RAG endpoint
app.post("/ask", async (req, res) => {
  const { question } = req.body;

  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'question' field" });
  }

  // Basic input length limit (cost + injection mitigation)
  if (question.length > 500) {
    return res.status(400).json({ error: "Question too long (max 500 characters)" });
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
  console.log(`  POST /ask  - Ask a question`);
  console.log(`  GET /health - Health check`);
  console.log(`  Search: Azure AI Search (hybrid)`);
  console.log(`  Chat model: ${config.chatModel}`);
});
