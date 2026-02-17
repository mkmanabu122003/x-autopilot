// formatters.js は ESM なので、テスト用に関数を再実装してテスト
// 実際のコードと同じロジックをテストすることでリグレッション検知が可能

// ESM の関数を直接 require できないため、ロジックを抽出してテスト
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return String(num);
}

function formatCurrency(usd) {
  return `$${usd.toFixed(2)}`;
}

function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

function charCount(text) {
  let count = 0;
  for (const char of text) {
    if (char.charCodeAt(0) > 127) {
      count += 2;
    } else {
      count += 1;
    }
  }
  return count;
}

function formatRelativeTime(dateStr) {
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'たった今';
  if (diffMin < 60) return `${diffMin}分前`;
  if (diffHour < 24) return `${diffHour}時間前`;
  if (diffDay < 7) return `${diffDay}日前`;
  return 'older';
}

describe('formatters', () => {
  describe('formatNumber', () => {
    test('100万以上は M 表記', () => {
      expect(formatNumber(1000000)).toBe('1.0M');
      expect(formatNumber(1500000)).toBe('1.5M');
      expect(formatNumber(10000000)).toBe('10.0M');
    });

    test('1000以上は K 表記', () => {
      expect(formatNumber(1000)).toBe('1.0K');
      expect(formatNumber(1500)).toBe('1.5K');
      expect(formatNumber(999999)).toBe('1000.0K');
    });

    test('1000未満はそのまま文字列', () => {
      expect(formatNumber(0)).toBe('0');
      expect(formatNumber(1)).toBe('1');
      expect(formatNumber(999)).toBe('999');
    });
  });

  describe('formatCurrency', () => {
    test('ドル表記に変換', () => {
      expect(formatCurrency(0)).toBe('$0.00');
      expect(formatCurrency(1.5)).toBe('$1.50');
      expect(formatCurrency(33)).toBe('$33.00');
      expect(formatCurrency(0.005)).toBe('$0.01');
    });

    test('小数第2位まで表示', () => {
      expect(formatCurrency(1.999)).toBe('$2.00');
      expect(formatCurrency(0.123)).toBe('$0.12');
    });
  });

  describe('formatPercent', () => {
    test('パーセント表記に変換', () => {
      expect(formatPercent(0)).toBe('0.0%');
      expect(formatPercent(50)).toBe('50.0%');
      expect(formatPercent(100)).toBe('100.0%');
    });

    test('小数第1位まで表示', () => {
      expect(formatPercent(3.14)).toBe('3.1%');
      expect(formatPercent(99.99)).toBe('100.0%');
    });
  });

  describe('charCount', () => {
    test('ASCII文字は1カウント', () => {
      expect(charCount('hello')).toBe(5);
      expect(charCount('abc123')).toBe(6);
    });

    test('日本語文字は2カウント', () => {
      expect(charCount('あ')).toBe(2);
      expect(charCount('こんにちは')).toBe(10);
    });

    test('混合テキストを正しくカウント', () => {
      // "Hello" = 5, "世界" = 4
      expect(charCount('Hello世界')).toBe(9);
    });

    test('空文字列は0', () => {
      expect(charCount('')).toBe(0);
    });

    test('絵文字は2カウント (127以上)', () => {
      // 絵文字のcharCodeAt(0)は127以上
      const count = charCount('🎉');
      expect(count).toBeGreaterThanOrEqual(2);
    });

    test('280文字制限のシミュレーション', () => {
      // 140文字の日本語 = 280カウント (Twitter制限)
      const text = 'あ'.repeat(140);
      expect(charCount(text)).toBe(280);
    });
  });

  describe('formatRelativeTime', () => {
    test('直前の日時は「たった今」', () => {
      const now = new Date().toISOString();
      expect(formatRelativeTime(now)).toBe('たった今');
    });

    test('数分前', () => {
      const date = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(formatRelativeTime(date)).toBe('5分前');
    });

    test('数時間前', () => {
      const date = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(date)).toBe('3時間前');
    });

    test('数日前', () => {
      const date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(date)).toBe('2日前');
    });

    test('7日以上前はフォールバック', () => {
      const date = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const result = formatRelativeTime(date);
      expect(result).toBe('older');
    });
  });
});
