"use client";

import { useState } from "react";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const EXAMPLES = [
  "What are the penalties for HIPAA violations?",
  "How does 42 CFR Part 2 differ from HIPAA regarding patient consent?",
  "Which states have stricter privacy laws than HIPAA?",
  "What are the FDA 21 CFR Part 11 requirements for audit trails?",
];

export default function Home() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!question.trim() || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${API_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Server error");
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err.message || "Failed to connect to the server");
    } finally {
      setLoading(false);
    }
  }

  function handleExample(text) {
    setQuestion(text);
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Healthcare Regulatory Compliance</h1>
        <p className={styles.subtitle}>
          AI-powered assistant for HIPAA, HITECH, 42 CFR Part 2, FDA 21 CFR Part 11, and state privacy laws
        </p>
      </header>

      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about healthcare regulations..."
          className={styles.input}
          disabled={loading}
          maxLength={500}
        />
        <button type="submit" className={styles.button} disabled={loading || !question.trim()}>
          {loading ? "..." : "Ask"}
        </button>
      </form>

      {!result && !loading && !error && (
        <div className={styles.examples}>
          <p className={styles.examplesLabel}>Try one of these questions:</p>
          <div className={styles.examplesList}>
            {EXAMPLES.map((ex) => (
              <button key={ex} className={styles.exampleBtn} onClick={() => handleExample(ex)}>
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p className={styles.loadingText}>Searching regulations and generating answer...</p>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {result && (
        <div className={styles.resultCard}>
          <p className={styles.answerLabel}>Answer</p>
          <p className={styles.answer}>{result.answer}</p>

          <div className={styles.sources}>
            {result.sources.map((src) => (
              <span key={src} className={styles.sourceTag}>
                {src}
              </span>
            ))}
          </div>

          <div className={styles.meta}>
            <span className={styles.metaItem}>
              Chunks: <span className={styles.metaValue}>{result.chunksRetrieved}</span>
            </span>
            <span className={styles.metaItem}>
              Time: <span className={styles.metaValue}>{(result.elapsedMs / 1000).toFixed(1)}s</span>
            </span>
            {result.costs && (
              <span className={styles.metaItem}>
                Cost: <span className={styles.metaValue}>${result.costs.estimatedCostUsd.toFixed(6)}</span>
              </span>
            )}
            {result.costs && (
              <span className={styles.metaItem}>
                Tokens: <span className={styles.metaValue}>
                  {result.costs.llmInputTokens + result.costs.llmOutputTokens}
                </span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
