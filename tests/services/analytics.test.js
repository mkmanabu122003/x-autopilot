const { calculateEngagementRate } = require('../../server/services/analytics');

describe('analytics', () => {
  describe('calculateEngagementRate', () => {
    test('正常なメトリクスでエンゲージメント率を計算', () => {
      const metrics = {
        like_count: 50,
        retweet_count: 10,
        reply_count: 5,
        quote_count: 3,
        impression_count: 10000
      };
      // (50 + 10 + 5 + 3) / 10000 * 100 = 0.68
      expect(calculateEngagementRate(metrics)).toBeCloseTo(0.68, 2);
    });

    test('インプレッション 0 の場合は 0 を返す', () => {
      const metrics = {
        like_count: 10,
        retweet_count: 5,
        reply_count: 2,
        quote_count: 1,
        impression_count: 0
      };
      expect(calculateEngagementRate(metrics)).toBe(0);
    });

    test('インプレッションが null の場合は 0 を返す', () => {
      const metrics = {
        like_count: 10,
        retweet_count: 5,
        reply_count: 2,
        quote_count: 1,
        impression_count: null
      };
      expect(calculateEngagementRate(metrics)).toBe(0);
    });

    test('インプレッションが undefined の場合は 0 を返す', () => {
      const metrics = {
        like_count: 10,
        retweet_count: 5,
        reply_count: 2,
        quote_count: 1,
        impression_count: undefined
      };
      expect(calculateEngagementRate(metrics)).toBe(0);
    });

    test('全メトリクスが 0 の場合は 0 を返す', () => {
      const metrics = {
        like_count: 0,
        retweet_count: 0,
        reply_count: 0,
        quote_count: 0,
        impression_count: 1000
      };
      expect(calculateEngagementRate(metrics)).toBe(0);
    });

    test('高エンゲージメント率を正しく計算', () => {
      const metrics = {
        like_count: 500,
        retweet_count: 200,
        reply_count: 100,
        quote_count: 50,
        impression_count: 1000
      };
      // (500 + 200 + 100 + 50) / 1000 * 100 = 85%
      expect(calculateEngagementRate(metrics)).toBeCloseTo(85, 0);
    });

    test('少数のインプレッションでも正しく計算', () => {
      const metrics = {
        like_count: 1,
        retweet_count: 0,
        reply_count: 0,
        quote_count: 0,
        impression_count: 1
      };
      // (1 + 0 + 0 + 0) / 1 * 100 = 100
      expect(calculateEngagementRate(metrics)).toBe(100);
    });

    test('大きなインプレッション数でも正しく計算', () => {
      const metrics = {
        like_count: 10000,
        retweet_count: 5000,
        reply_count: 2000,
        quote_count: 1000,
        impression_count: 1000000
      };
      // (10000 + 5000 + 2000 + 1000) / 1000000 * 100 = 1.8
      expect(calculateEngagementRate(metrics)).toBeCloseTo(1.8, 1);
    });
  });
});
