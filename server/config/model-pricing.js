module.exports = {
  claude: {
    "claude-opus-4-6": {
      inputPerMTok: 5.00,
      outputPerMTok: 25.00,
      cacheWritePerMTok: 6.25,
      cacheReadPerMTok: 0.50,
      label: "Opus 4.6（最高品質）"
    },
    "claude-sonnet-4-5-20250929": {
      inputPerMTok: 3.00,
      outputPerMTok: 15.00,
      cacheWritePerMTok: 3.75,
      cacheReadPerMTok: 0.30,
      label: "Sonnet 4.5（バランス型）"
    },
    "claude-sonnet-4-20250514": {
      inputPerMTok: 3.00,
      outputPerMTok: 15.00,
      cacheWritePerMTok: 3.75,
      cacheReadPerMTok: 0.30,
      label: "Sonnet 4（標準）"
    },
    "claude-haiku-4-5-20251001": {
      inputPerMTok: 1.00,
      outputPerMTok: 5.00,
      cacheWritePerMTok: 1.25,
      cacheReadPerMTok: 0.10,
      label: "Haiku 4.5（高速・低コスト）"
    }
  },
  gemini: {
    "gemini-2.5-pro": {
      inputPerMTok: 1.25,
      outputPerMTok: 10.00,
      label: "Gemini 2.5 Pro（高品質）"
    },
    "gemini-2.5-flash": {
      inputPerMTok: 0.15,
      outputPerMTok: 0.60,
      label: "Gemini 2.5 Flash（バランス型）"
    },
    "gemini-2.0-flash": {
      inputPerMTok: 0.10,
      outputPerMTok: 0.40,
      label: "Gemini 2.0 Flash（高速・最安）"
    },
    "gemini-2.0-flash-lite": {
      inputPerMTok: 0.075,
      outputPerMTok: 0.30,
      label: "Gemini 2.0 Flash Lite（最安）"
    },
    "gemini-1.5-pro": {
      inputPerMTok: 1.25,
      outputPerMTok: 5.00,
      label: "Gemini 1.5 Pro"
    },
    "gemini-1.5-flash": {
      inputPerMTok: 0.075,
      outputPerMTok: 0.30,
      label: "Gemini 1.5 Flash"
    }
  }
};
