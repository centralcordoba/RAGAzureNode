/**
 * RAG chain: hybrid retrieval (Azure AI Search) + prompt template + LLM.
 */
const { PromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { RunnableSequence } = require("@langchain/core/runnables");
const { getEmbeddings } = require("./embeddings");
const { getChatModel } = require("./llm");
const { hybridSearch } = require("./search");
const { trackRequest } = require("../utils/costs");
const config = require("../config");

/**
 * Anti-hallucination prompt template.
 */
const PROMPT_TEMPLATE = `You are a healthcare regulatory compliance expert. Answer the question based ONLY on the following context. If the context does not contain enough information to answer the question, say "I don't have enough information to answer that question based on the available documents."

IMPORTANT RULES:
- Only use information from the provided context
- Do not make up or infer information not explicitly stated
- Cite the source document for each piece of information
- Be precise with regulatory names, penalties, and requirements
- If multiple regulations apply, mention all relevant ones

Context:
{context}

Question: {question}

Answer:`;

/**
 * Query the RAG system using Azure AI Search hybrid retrieval.
 * Returns { answer, sources, chunksRetrieved, elapsedMs }
 */
async function query(question) {
  const startTime = Date.now();

  // 1. Generate embedding for the question
  const embeddings = getEmbeddings();
  const queryVector = await embeddings.embedQuery(question);

  // 2. Hybrid search: vector + keyword (BM25)
  const relevantDocs = await hybridSearch(question, queryVector);

  // 3. Format context from retrieved documents
  const context = relevantDocs
    .map((doc) => `[Source: ${doc.source}]\n${doc.content}`)
    .join("\n\n---\n\n");

  // 4. Build and run the chain
  const prompt = PromptTemplate.fromTemplate(PROMPT_TEMPLATE);
  const llm = getChatModel();
  const outputParser = new StringOutputParser();

  const chain = RunnableSequence.from([prompt, llm, outputParser]);

  const answer = await chain.invoke({ context, question });

  // 5. Extract unique sources
  const sources = [...new Set(relevantDocs.map((d) => d.source))];

  // 6. Track costs
  const costs = trackRequest({ question, context, answer });

  const elapsed = Date.now() - startTime;

  // 7. Logging
  const logEntry = {
    timestamp: new Date().toISOString(),
    question: question.substring(0, 100),
    chunksRetrieved: relevantDocs.length,
    sources,
    responseLength: answer.length,
    elapsedMs: elapsed,
    costs,
  };
  console.log("[RAG Query]", JSON.stringify(logEntry));

  return {
    answer,
    sources,
    chunksRetrieved: relevantDocs.length,
    elapsedMs: elapsed,
    costs,
  };
}

module.exports = { query };
