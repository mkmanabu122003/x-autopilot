const { getDb } = require('../db/database');

// ── Pattern Definitions ──

const OPENING_PATTERNS = {
  'O-A': { name: 'ゲストのセリフ', description: '「」で始まる。ゲストの生の発言から入る' },
  'O-B': { name: '数字・場所・時間', description: '具体的な情景描写から入る（例：「浅草の雷門前、朝8時。」）' },
  'O-C': { name: '失敗・違和感', description: '自分がつまずいた瞬間から入る' },
  'O-D': { name: '常識の否定', description: '通説をひっくり返す一文から入る（例：「語彙力があればガイドできる、は嘘。」）' },
  'O-E': { name: '比較・対比', description: '2つの事象の差分から入る' },
};

const DEVELOPMENT_PATTERNS = {
  'D-A': { name: '対比構造', description: '2つの概念を行き来する' },
  'D-B': { name: 'エピソード深掘り', description: '1つの出来事だけを具体的に描写する' },
  'D-C': { name: '時系列＋脱線', description: '時間順だが途中で自問・脱線を1回以上挟む' },
  'D-D': { name: '列挙崩し', description: '一見リストだが途中で1項目だけ深掘りする' },
};

const CLOSING_PATTERNS = {
  'C-A': { name: '断言', description: '言い切りで閉じる' },
  'C-B': { name: '問いかけ', description: '読者に考えさせる問いで開く' },
  'C-C': { name: '余韻', description: '結論を明示せず情景や感覚で閉じる' },
  'C-D': { name: '行動示唆', description: '「明日から試せる」系の次のアクションで閉じる' },
};

/**
 * Fetch recent pattern usage history for an account.
 * Returns an array of { opening_pattern, development_pattern, closing_pattern, expressions }
 * ordered from newest to oldest.
 */
async function getRecentPatternHistory(accountId, limit = 5) {
  try {
    const sb = getDb();
    const { data, error } = await sb.from('tweet_pattern_log')
      .select('opening_pattern, development_pattern, closing_pattern, expressions')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('PatternRotation: failed to fetch history:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('PatternRotation: error fetching history:', err.message);
    return [];
  }
}

/**
 * Compute pattern constraints based on recent history.
 *
 * Rules:
 * - 直近2件と同じ冒頭パターンは使用禁止
 * - 直近3件で2回以上使われた展開パターンは使用禁止
 * - 直近2件と同じ締めパターンは使用禁止
 * - 直近5件のexpressionsに含まれる単語・フレーズの再利用を避ける
 * - 制約適用後、選択肢が1つしか残らない場合はそれを使用してよい
 */
function computeConstraints(history) {
  const forbiddenOpening = new Set();
  const forbiddenDevelopment = new Set();
  const forbiddenClosing = new Set();
  const avoidExpressions = [];

  // Rule 1: 直近2件と同じ冒頭パターンは使用禁止
  const recent2 = history.slice(0, 2);
  for (const entry of recent2) {
    if (entry.opening_pattern) forbiddenOpening.add(entry.opening_pattern);
  }

  // Rule 2: 直近3件で2回以上使われた展開パターンは使用禁止
  const recent3 = history.slice(0, 3);
  const devCounts = {};
  for (const entry of recent3) {
    if (entry.development_pattern) {
      devCounts[entry.development_pattern] = (devCounts[entry.development_pattern] || 0) + 1;
    }
  }
  for (const [pattern, count] of Object.entries(devCounts)) {
    if (count >= 2) forbiddenDevelopment.add(pattern);
  }

  // Rule 3: 直近2件と同じ締めパターンは使用禁止
  for (const entry of recent2) {
    if (entry.closing_pattern) forbiddenClosing.add(entry.closing_pattern);
  }

  // Rule 4: 直近5件のexpressionsに含まれる単語・フレーズの再利用を避ける
  const recent5 = history.slice(0, 5);
  for (const entry of recent5) {
    if (Array.isArray(entry.expressions)) {
      avoidExpressions.push(...entry.expressions);
    }
  }

  return {
    forbiddenOpening: [...forbiddenOpening],
    forbiddenDevelopment: [...forbiddenDevelopment],
    forbiddenClosing: [...forbiddenClosing],
    avoidExpressions: [...new Set(avoidExpressions)]
  };
}

/**
 * Get available patterns after applying constraints.
 * If all patterns in a category are forbidden, allow all (safety fallback).
 */
function getAvailablePatterns(constraints) {
  const available = {
    opening: Object.keys(OPENING_PATTERNS).filter(p => !constraints.forbiddenOpening.includes(p)),
    development: Object.keys(DEVELOPMENT_PATTERNS).filter(p => !constraints.forbiddenDevelopment.includes(p)),
    closing: Object.keys(CLOSING_PATTERNS).filter(p => !constraints.forbiddenClosing.includes(p)),
  };

  if (available.opening.length === 0) available.opening = Object.keys(OPENING_PATTERNS);
  if (available.development.length === 0) available.development = Object.keys(DEVELOPMENT_PATTERNS);
  if (available.closing.length === 0) available.closing = Object.keys(CLOSING_PATTERNS);

  return available;
}

/**
 * Build a prompt block describing pattern constraints.
 * Injected into the user prompt at generation time.
 */
function buildConstraintPromptBlock(constraints) {
  const parts = [];

  const hasForbidden = constraints.forbiddenOpening.length > 0 ||
    constraints.forbiddenDevelopment.length > 0 ||
    constraints.forbiddenClosing.length > 0;
  const hasExpressions = constraints.avoidExpressions.length > 0;

  if (!hasForbidden && !hasExpressions) return '';

  parts.push('\n## パターン制約（自動適用・必ず守ること）');

  if (constraints.forbiddenOpening.length > 0) {
    const names = constraints.forbiddenOpening.map(code => {
      const p = OPENING_PATTERNS[code];
      return p ? `${code}（${p.name}）` : code;
    });
    parts.push(`- 冒頭で使用禁止: ${names.join(', ')}`);
  }

  if (constraints.forbiddenDevelopment.length > 0) {
    const names = constraints.forbiddenDevelopment.map(code => {
      const p = DEVELOPMENT_PATTERNS[code];
      return p ? `${code}（${p.name}）` : code;
    });
    parts.push(`- 展開で使用禁止: ${names.join(', ')}`);
  }

  if (constraints.forbiddenClosing.length > 0) {
    const names = constraints.forbiddenClosing.map(code => {
      const p = CLOSING_PATTERNS[code];
      return p ? `${code}（${p.name}）` : code;
    });
    parts.push(`- 締めで使用禁止: ${names.join(', ')}`);
  }

  if (hasExpressions) {
    parts.push(`- 避けるべき表現（直近投稿で使用済み）: 「${constraints.avoidExpressions.join('」「')}」`);
  }

  return parts.join('\n');
}

/**
 * Log pattern usage for a generated tweet.
 */
async function logPatternUsage(accountId, { openingPattern, developmentPattern, closingPattern, expressions }) {
  try {
    const sb = getDb();
    await sb.from('tweet_pattern_log').insert({
      account_id: accountId,
      opening_pattern: openingPattern || null,
      development_pattern: developmentPattern || null,
      closing_pattern: closingPattern || null,
      expressions: expressions || []
    });
  } catch (err) {
    console.warn('PatternRotation: failed to log pattern usage:', err.message);
  }
}

/**
 * High-level function: get pattern constraints and build prompt block for an account.
 * Returns empty string if no history or table doesn't exist.
 */
async function getPatternConstraintBlock(accountId) {
  const history = await getRecentPatternHistory(accountId);
  const constraints = computeConstraints(history);
  return buildConstraintPromptBlock(constraints);
}

module.exports = {
  OPENING_PATTERNS,
  DEVELOPMENT_PATTERNS,
  CLOSING_PATTERNS,
  getRecentPatternHistory,
  computeConstraints,
  getAvailablePatterns,
  buildConstraintPromptBlock,
  logPatternUsage,
  getPatternConstraintBlock
};
