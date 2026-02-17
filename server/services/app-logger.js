const { getDb } = require('../db/database');

const VALID_LEVELS = ['error', 'warn', 'info'];

/**
 * アプリケーションログをDBに記録する
 * @param {'error'|'warn'|'info'} level
 * @param {string} category - 'api', 'auto_post', 'batch', 'system' など
 * @param {string} message
 * @param {object} [details] - エラースタック、リクエスト情報など
 */
async function log(level, category, message, details = null) {
  if (!VALID_LEVELS.includes(level)) level = 'info';
  try {
    const sb = getDb();
    await sb.from('app_logs').insert({
      level,
      category: category || 'system',
      message: String(message),
      details: details || null
    });
  } catch (err) {
    // DB書き込み失敗時はconsoleにフォールバック
    console.warn('[app-logger] Failed to write log to DB:', err.message);
    console.log(`[${level.toUpperCase()}] [${category}] ${message}`);
  }
}

function logError(category, message, details) {
  return log('error', category, message, details);
}

function logWarn(category, message, details) {
  return log('warn', category, message, details);
}

function logInfo(category, message, details) {
  return log('info', category, message, details);
}

/**
 * ログを取得する（フィルタ・ページネーション対応）
 */
async function getLogs({ level, category, limit = 100, offset = 0 } = {}) {
  const sb = getDb();
  let query = sb.from('app_logs').select('*');

  if (level && VALID_LEVELS.includes(level)) {
    query = query.eq('level', level);
  }
  if (category) {
    query = query.eq('category', category);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return data || [];
}

/**
 * ログの件数を取得する
 */
async function getLogCount({ level, category } = {}) {
  const sb = getDb();
  let query = sb.from('app_logs').select('id', { count: 'exact', head: true });

  if (level && VALID_LEVELS.includes(level)) {
    query = query.eq('level', level);
  }
  if (category) {
    query = query.eq('category', category);
  }

  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

/**
 * 古いログを削除する（保持日数指定）
 */
async function cleanOldLogs(retentionDays = 30) {
  const sb = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const { error } = await sb.from('app_logs')
    .delete()
    .lt('created_at', cutoff.toISOString());

  if (error) {
    console.warn('[app-logger] Failed to clean old logs:', error.message);
  }
}

module.exports = {
  log,
  logError,
  logWarn,
  logInfo,
  getLogs,
  getLogCount,
  cleanOldLogs,
  VALID_LEVELS
};
