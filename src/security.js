/**
 * Security module.
 * Basic prompt injection mitigation and input sanitization.
 */

/**
 * Patterns that indicate prompt injection attempts.
 * These are common techniques used to override system prompts.
 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts|rules)/i,
  /disregard\s+(all\s+)?(previous|above|prior)/i,
  /you\s+are\s+now\s+/i,
  /new\s+instructions?\s*:/i,
  /system\s*prompt\s*:/i,
  /\bact\s+as\s+(a\s+)?(?!healthcare)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /jailbreak/i,
  /do\s+anything\s+now/i,
  /override\s+(your|the)\s+(rules|instructions|prompt)/i,
];

/**
 * Check if a question contains prompt injection patterns.
 * Returns { safe: boolean, reason?: string }
 */
function validateQuestion(question) {
  // Check for injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(question)) {
      return {
        safe: false,
        reason: "Question contains disallowed patterns",
      };
    }
  }

  // Check for excessive special characters (possible encoding attacks)
  const specialCharRatio =
    (question.replace(/[a-zA-Z0-9\s.,?!'"()-]/g, "").length) / question.length;
  if (specialCharRatio > 0.3) {
    return {
      safe: false,
      reason: "Question contains too many special characters",
    };
  }

  return { safe: true };
}

module.exports = { validateQuestion };
