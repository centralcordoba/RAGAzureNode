/**
 * Ingestion script: reads .txt documents, chunks them, generates embeddings,
 * and uploads them to Azure AI Search.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { Document } = require("@langchain/core/documents");
const { getEmbeddings } = require("./embeddings");
const { createIndex, uploadDocuments } = require("./search");
const config = require("./config");

const DOCS_DIR = path.join(__dirname, "..", "docs");

/**
 * Load all .txt files from the docs directory.
 */
function loadDocuments() {
  const files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith(".txt"));
  console.log(`Found ${files.length} document(s) to ingest.`);

  const docs = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(DOCS_DIR, file), "utf-8");
    docs.push(
      new Document({
        pageContent: content,
        metadata: { source: file },
      })
    );
    console.log(`  Loaded: ${file} (${content.length} chars)`);
  }
  return docs;
}

/**
 * Split documents into chunks using RecursiveCharacterTextSplitter.
 */
async function chunkDocuments(docs) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    separators: ["\n\n", "\n", ". ", " ", ""],
  });

  const chunks = await splitter.splitDocuments(docs);
  console.log(`\nChunking complete: ${docs.length} docs -> ${chunks.length} chunks`);
  console.log(
    `  Chunk size: ${config.chunkSize} chars, overlap: ${config.chunkOverlap} chars`
  );
  return chunks;
}

/**
 * Generate embeddings for all chunks and upload to Azure AI Search.
 */
async function indexChunks(chunks) {
  console.log("\nGenerating embeddings (Azure OpenAI)...");
  const embeddings = getEmbeddings();

  // Generate embeddings for all chunks
  const texts = chunks.map((c) => c.pageContent);
  const vectors = await embeddings.embedDocuments(texts);
  console.log(`  Generated ${vectors.length} embeddings (${vectors[0].length} dims)`);

  // Prepare documents for Azure AI Search
  const searchDocs = chunks.map((chunk, i) => ({
    id: crypto
      .createHash("md5")
      .update(chunk.pageContent)
      .digest("hex"),
    content: chunk.pageContent,
    contentVector: vectors[i],
    source: chunk.metadata.source,
  }));

  // Create index and upload
  console.log("\nCreating Azure AI Search index...");
  await createIndex();

  console.log("\nUploading to Azure AI Search...");
  await uploadDocuments(searchDocs);
}

async function main() {
  console.log("=== RAG Ingestion Pipeline (Azure AI Search) ===\n");

  const startTime = Date.now();
  const docs = loadDocuments();
  const chunks = await chunkDocuments(docs);
  await indexChunks(chunks);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
