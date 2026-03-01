/**
 * Azure AI Search module.
 * Handles index creation, document upload, and hybrid search.
 */
const {
  SearchClient,
  SearchIndexClient,
  AzureKeyCredential,
} = require("@azure/search-documents");
const config = require("../config");

const credential = new AzureKeyCredential(config.azureSearchKey);

/**
 * Creates the search index with vector, keyword, and metadata fields.
 * If the index already exists, it deletes and recreates it.
 */
async function createIndex() {
  const indexClient = new SearchIndexClient(
    config.azureSearchEndpoint,
    credential
  );

  const indexDefinition = {
    name: config.azureSearchIndex,
    fields: [
      { name: "id", type: "Edm.String", key: true, filterable: true },
      {
        name: "content",
        type: "Edm.String",
        searchable: true, // enables keyword (BM25) search
        analyzerName: "en.microsoft",
      },
      {
        name: "contentVector",
        type: "Collection(Edm.Single)",
        searchable: true,
        vectorSearchDimensions: 1536,
        vectorSearchProfileName: "vector-profile",
      },
      {
        name: "source",
        type: "Edm.String",
        filterable: true, // enables filtering by document source
        facetable: true,
      },
    ],
    vectorSearch: {
      algorithms: [
        {
          name: "hnsw-algorithm",
          kind: "hnsw",
          parameters: {
            metric: "cosine",
            m: 4,
            efConstruction: 400,
            efSearch: 500,
          },
        },
      ],
      profiles: [
        {
          name: "vector-profile",
          algorithmConfigurationName: "hnsw-algorithm",
        },
      ],
    },
  };

  // Delete index if it exists (clean re-ingestion)
  try {
    await indexClient.deleteIndex(config.azureSearchIndex);
    console.log("  Deleted existing index.");
  } catch (e) {
    // Index doesn't exist yet, that's fine
  }

  await indexClient.createIndex(indexDefinition);
  console.log(`  Created index: ${config.azureSearchIndex}`);
}

/**
 * Upload documents (chunks with embeddings) to the index.
 */
async function uploadDocuments(documents) {
  const searchClient = new SearchClient(
    config.azureSearchEndpoint,
    config.azureSearchIndex,
    credential
  );

  // Azure Search accepts batches of up to 1000 docs
  const batchSize = 100;
  let uploaded = 0;

  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    await searchClient.uploadDocuments(batch);
    uploaded += batch.length;
    console.log(`  Uploaded ${uploaded}/${documents.length} documents`);
  }
}

/**
 * Hybrid search: combines vector similarity + keyword (BM25) search.
 *
 * WHY hybrid?
 * - Vector search finds semantically similar content ("privacy violations" matches "HIPAA breaches")
 * - Keyword search finds exact terms ("42 CFR Part 2" matches exactly)
 * - Together they cover both semantic understanding AND exact regulatory terminology
 */
async function hybridSearch(queryText, queryVector) {
  const searchClient = new SearchClient(
    config.azureSearchEndpoint,
    config.azureSearchIndex,
    credential
  );

  const results = await searchClient.search(queryText, {
    vectorSearchOptions: {
      queries: [
        {
          kind: "vector",
          vector: queryVector,
          kNearestNeighborsCount: config.topK,
          fields: ["contentVector"],
        },
      ],
    },
    top: config.topK,
    select: ["id", "content", "source"],
  });

  const docs = [];
  for await (const result of results.results) {
    docs.push({
      content: result.document.content,
      source: result.document.source,
      score: result.score,
    });
  }

  return docs;
}

module.exports = { createIndex, uploadDocuments, hybridSearch };
