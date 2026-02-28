const {
  JST_OFFSET_MS,
  toJST,
  getStartOfMonthJST,
  getStartOfLastMonthJST,
  getEndOfLastMonthJST
} = require('../../server/utils/date-utils');

describe('date-utils (JST月境界)', () => {
  describe('toJST', () => {
    test('UTC時刻に9時間加算される', () => {
      const utc = new Date('2026-01-31T15:00:00.000Z');
      const jst = toJST(utc);
      // 15:00 UTC + 9h = 翌日 00:00 UTC (内部値)
      expect(jst.getUTCHours()).toBe(0);
      expect(jst.getUTCDate()).toBe(1);
      expect(jst.getUTCMonth()).toBe(1); // February
    });
  });

  describe('getStartOfMonthJST', () => {
    test('JST 2月1日 00:01 → 当月(2月)の開始を返す', () => {
      // 2026-02-01 00:01 JST = 2026-01-31 15:01 UTC
      const now = new Date('2026-01-31T15:01:00.000Z');
      const result = getStartOfMonthJST(now);
      // 2月1日 00:00 JST = 1月31日 15:00 UTC
      expect(result).toBe('2026-01-31T15:00:00.000Z');
    });

    test('JST 1月31日 23:59 → 当月(1月)の開始を返す', () => {
      // 2026-01-31 23:59 JST = 2026-01-31 14:59 UTC
      const now = new Date('2026-01-31T14:59:00.000Z');
      const result = getStartOfMonthJST(now);
      // 1月1日 00:00 JST = 12月31日 15:00 UTC
      expect(result).toBe('2025-12-31T15:00:00.000Z');
    });

    test('UTCでは前月だがJSTでは翌月の場合に正しく新月を返す', () => {
      // これが修正前のバグの核心:
      // UTC: 2026-01-31 15:00 (まだ1月)
      // JST: 2026-02-01 00:00 (もう2月)
      const now = new Date('2026-01-31T15:00:00.000Z');
      const result = getStartOfMonthJST(now);
      // JST 2月1日開始 = UTC 1月31日15:00
      expect(result).toBe('2026-01-31T15:00:00.000Z');
    });

    test('UTCとJSTが同じ月の場合も正しく動く', () => {
      // 2026-02-15 12:00 UTC = 2026-02-15 21:00 JST (両方2月)
      const now = new Date('2026-02-15T12:00:00.000Z');
      const result = getStartOfMonthJST(now);
      // 2月1日 00:00 JST = 1月31日 15:00 UTC
      expect(result).toBe('2026-01-31T15:00:00.000Z');
    });

    test('年またぎ: JST 1月1日 00:00', () => {
      // 2026-01-01 00:00 JST = 2025-12-31 15:00 UTC
      const now = new Date('2025-12-31T15:00:00.000Z');
      const result = getStartOfMonthJST(now);
      // 1月1日 00:00 JST = 12月31日 15:00 UTC
      expect(result).toBe('2025-12-31T15:00:00.000Z');
    });

    test('年またぎ: JST 12月31日 23:59', () => {
      // 2025-12-31 23:59 JST = 2025-12-31 14:59 UTC
      const now = new Date('2025-12-31T14:59:00.000Z');
      const result = getStartOfMonthJST(now);
      // 12月1日 00:00 JST = 11月30日 15:00 UTC
      expect(result).toBe('2025-11-30T15:00:00.000Z');
    });
  });

  describe('getStartOfLastMonthJST', () => {
    test('JST 2月 → 1月1日開始を返す', () => {
      const now = new Date('2026-01-31T15:01:00.000Z'); // Feb 1, 00:01 JST
      const result = getStartOfLastMonthJST(now);
      // 1月1日 00:00 JST = 12月31日 15:00 UTC
      expect(result).toBe('2025-12-31T15:00:00.000Z');
    });

    test('JST 1月 → 前年12月1日開始を返す', () => {
      const now = new Date('2026-01-15T00:00:00.000Z'); // Jan 15, 09:00 JST
      const result = getStartOfLastMonthJST(now);
      // 2025-12-01 00:00 JST = 2025-11-30 15:00 UTC
      expect(result).toBe('2025-11-30T15:00:00.000Z');
    });
  });

  describe('getEndOfLastMonthJST', () => {
    test('JST 2月 → 1月31日 23:59:59 を返す', () => {
      const now = new Date('2026-01-31T15:01:00.000Z'); // Feb 1, 00:01 JST
      const result = getEndOfLastMonthJST(now);
      // 1月31日 23:59:59 JST = 1月31日 14:59:59 UTC
      expect(result).toBe('2026-01-31T14:59:59.000Z');
    });

    test('JST 3月 → 2月28日 23:59:59 を返す (非うるう年)', () => {
      // 2027-03-01 00:00 JST = 2027-02-28 15:00 UTC
      const now = new Date('2027-02-28T15:00:00.000Z');
      const result = getEndOfLastMonthJST(now);
      // 2月28日 23:59:59 JST = 2月28日 14:59:59 UTC
      expect(result).toBe('2027-02-28T14:59:59.000Z');
    });

    test('先月末日は今月開始の1秒前になる', () => {
      const now = new Date('2026-01-31T15:01:00.000Z'); // Feb 1 JST
      const start = new Date(getStartOfMonthJST(now)).getTime();
      const end = new Date(getEndOfLastMonthJST(now)).getTime();
      expect(start - end).toBe(1000); // 1秒差
    });
  });

  describe('月またぎバグの再現テスト', () => {
    test('JST月初直後でも前月コストを含めない', () => {
      // シナリオ: 1月末にAPI使用、2月1日 00:01 JSTに確認
      const jan31_2300_jst = new Date('2026-01-31T14:00:00.000Z'); // 1/31 23:00 JST
      const feb01_0001_jst = new Date('2026-01-31T15:01:00.000Z'); // 2/1 00:01 JST

      const startOfFeb = getStartOfMonthJST(feb01_0001_jst);
      const startFebDate = new Date(startOfFeb);

      // 1月31日のレコードは2月の予算に含まれないこと
      expect(jan31_2300_jst.getTime()).toBeLessThan(startFebDate.getTime());
    });

    test('JST月末直前のコストは当月に含まれる', () => {
      // 1月31日 23:59 JST のレコードは1月の予算に含まれること
      const jan31_2359_jst = new Date('2026-01-31T14:59:00.000Z'); // 1/31 23:59 JST
      const checkTime = new Date('2026-01-31T14:30:00.000Z'); // 1/31 23:30 JST

      const startOfJan = getStartOfMonthJST(checkTime);
      const startJanDate = new Date(startOfJan);

      expect(jan31_2359_jst.getTime()).toBeGreaterThanOrEqual(startJanDate.getTime());
    });
  });
});
