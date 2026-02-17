const { calculateCost, getProviderForModel } = require('../../server/services/cost-calculator');

describe('cost-calculator', () => {
  describe('getProviderForModel', () => {
    test('Claude Sonnet 4 のプロバイダーは claude', () => {
      expect(getProviderForModel('claude-sonnet-4-20250514')).toBe('claude');
    });

    test('Claude Opus 4.6 のプロバイダーは claude', () => {
      expect(getProviderForModel('claude-opus-4-6')).toBe('claude');
    });

    test('Claude Haiku 4.5 のプロバイダーは claude', () => {
      expect(getProviderForModel('claude-haiku-4-5-20251001')).toBe('claude');
    });

    test('Gemini 2.0 Flash のプロバイダーは gemini', () => {
      expect(getProviderForModel('gemini-2.0-flash')).toBe('gemini');
    });

    test('Gemini 2.5 Pro のプロバイダーは gemini', () => {
      expect(getProviderForModel('gemini-2.5-pro')).toBe('gemini');
    });

    test('存在しないモデルは null を返す', () => {
      expect(getProviderForModel('unknown-model')).toBeNull();
    });

    test('空文字列は null を返す', () => {
      expect(getProviderForModel('')).toBeNull();
    });
  });

  describe('calculateCost', () => {
    test('Claude Sonnet 4 の基本コスト計算', () => {
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0
      };
      // input: 1000 / 1_000_000 * 3.00 = 0.003
      // output: 500 / 1_000_000 * 15.00 = 0.0075
      // total = 0.0105
      const cost = calculateCost(usage, 'claude-sonnet-4-20250514');
      expect(cost).toBeCloseTo(0.0105, 4);
    });

    test('Claude Opus 4.6 のコスト計算', () => {
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0
      };
      // input: 1000 / 1_000_000 * 5.00 = 0.005
      // output: 500 / 1_000_000 * 25.00 = 0.0125
      // total = 0.0175
      const cost = calculateCost(usage, 'claude-opus-4-6');
      expect(cost).toBeCloseTo(0.0175, 4);
    });

    test('キャッシュ読取トークンのコスト計算', () => {
      const usage = {
        input_tokens: 2000,
        output_tokens: 100,
        cache_read_input_tokens: 1500,
        cache_creation_input_tokens: 0
      };
      // normalInput: 2000 - 1500 - 0 = 500
      // input cost: 500 / 1_000_000 * 3.00 = 0.0015
      // cache read: 1500 / 1_000_000 * 0.30 = 0.00045
      // output: 100 / 1_000_000 * 15.00 = 0.0015
      // total = 0.00345
      const cost = calculateCost(usage, 'claude-sonnet-4-20250514');
      expect(cost).toBeCloseTo(0.00345, 5);
    });

    test('キャッシュ書込トークンのコスト計算', () => {
      const usage = {
        input_tokens: 2000,
        output_tokens: 100,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 1000
      };
      // normalInput: 2000 - 0 - 1000 = 1000
      // input cost: 1000 / 1_000_000 * 3.00 = 0.003
      // cache write: 1000 / 1_000_000 * 3.75 = 0.00375
      // output: 100 / 1_000_000 * 15.00 = 0.0015
      // total = 0.00825
      const cost = calculateCost(usage, 'claude-sonnet-4-20250514');
      expect(cost).toBeCloseTo(0.00825, 5);
    });

    test('バッチAPIで50%割引が適用される', () => {
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0
      };
      const normalCost = calculateCost(usage, 'claude-sonnet-4-20250514', false);
      const batchCost = calculateCost(usage, 'claude-sonnet-4-20250514', true);
      expect(batchCost).toBeCloseTo(normalCost * 0.5, 5);
    });

    test('Gemini 2.0 Flash のコスト計算', () => {
      const usage = {
        input_tokens: 10000,
        output_tokens: 2000,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0
      };
      // input: 10000 / 1_000_000 * 0.10 = 0.001
      // output: 2000 / 1_000_000 * 0.40 = 0.0008
      // total = 0.0018
      const cost = calculateCost(usage, 'gemini-2.0-flash');
      expect(cost).toBeCloseTo(0.0018, 4);
    });

    test('Gemini モデルはキャッシュコストが無い', () => {
      const usage = {
        input_tokens: 5000,
        output_tokens: 1000,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 1000
      };
      // normalInput: max(5000 - 2000 - 1000, 0) = 2000
      // input cost: 2000 / 1_000_000 * 0.10 = 0.0002
      // cache write: undefined → skip
      // cache read: undefined → skip
      // output: 1000 / 1_000_000 * 0.40 = 0.0004
      // total = 0.0006
      const cost = calculateCost(usage, 'gemini-2.0-flash');
      expect(cost).toBeCloseTo(0.0006, 4);
    });

    test('不明なモデルは 0 を返す', () => {
      const usage = { input_tokens: 1000, output_tokens: 500 };
      expect(calculateCost(usage, 'unknown-model')).toBe(0);
    });

    test('usage が空でもエラーにならない', () => {
      const cost = calculateCost({}, 'claude-sonnet-4-20250514');
      expect(cost).toBe(0);
    });

    test('トークン数が 0 の場合は 0 を返す', () => {
      const usage = {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0
      };
      expect(calculateCost(usage, 'claude-sonnet-4-20250514')).toBe(0);
    });

    test('normalInput が負にならない (cache > input の場合)', () => {
      const usage = {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 0
      };
      // normalInput: max(100 - 200 - 0, 0) = 0
      // cache read cost: 200 / 1_000_000 * 0.30 = 0.00006
      // output: 50 / 1_000_000 * 15.00 = 0.00075
      const cost = calculateCost(usage, 'claude-sonnet-4-20250514');
      expect(cost).toBeGreaterThanOrEqual(0);
    });

    test('Claude Haiku 4.5 は低コスト', () => {
      const usage = { input_tokens: 1000, output_tokens: 1000 };
      const haikuCost = calculateCost(usage, 'claude-haiku-4-5-20251001');
      const sonnetCost = calculateCost(usage, 'claude-sonnet-4-20250514');
      expect(haikuCost).toBeLessThan(sonnetCost);
    });
  });
});
