/**
 * JST (Asia/Tokyo, UTC+9) ベースの日付ユーティリティ
 *
 * サーバーがUTCで動作する環境（Vercel等）でも、
 * 日本時間の月境界を正しく計算するためのヘルパー関数群。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000; // UTC+9

/**
 * 指定時刻をJSTに変換した Date オブジェクトを返す。
 * 返される Date の getUTC*() メソッドがJSTの値を返す。
 */
function toJST(date) {
  return new Date(date.getTime() + JST_OFFSET_MS);
}

/**
 * JSTにおける今月1日 00:00:00 を UTC ISO文字列で返す。
 * 例: JST 2月なら "2026-01-31T15:00:00.000Z" (= 2/1 00:00 JST)
 */
function getStartOfMonthJST(now = new Date()) {
  const jst = toJST(now);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth();
  return new Date(Date.UTC(year, month, 1) - JST_OFFSET_MS).toISOString();
}

/**
 * JSTにおける先月1日 00:00:00 を UTC ISO文字列で返す。
 */
function getStartOfLastMonthJST(now = new Date()) {
  const jst = toJST(now);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth() - 1;
  return new Date(Date.UTC(year, month, 1) - JST_OFFSET_MS).toISOString();
}

/**
 * JSTにおける先月末日 23:59:59 を UTC ISO文字列で返す。
 */
function getEndOfLastMonthJST(now = new Date()) {
  const jst = toJST(now);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth();
  // 今月1日 00:00 JST の1秒前 = 先月末日 23:59:59 JST
  return new Date(Date.UTC(year, month, 1) - JST_OFFSET_MS - 1000).toISOString();
}

module.exports = {
  JST_OFFSET_MS,
  toJST,
  getStartOfMonthJST,
  getStartOfLastMonthJST,
  getEndOfLastMonthJST
};
