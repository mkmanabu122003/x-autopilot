// Mock database
jest.mock('../../server/db/database', () => {
  const mockChain = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
  return {
    getDb: jest.fn(() => ({
      from: jest.fn(() => mockChain)
    }))
  };
});

const {
  OPENING_PATTERNS,
  DEVELOPMENT_PATTERNS,
  CLOSING_PATTERNS,
  getRecentPatternHistory,
  computeConstraints,
  getAvailablePatterns,
  buildConstraintPromptBlock,
  logPatternUsage,
  getPatternConstraintBlock
} = require('../../server/services/pattern-rotation');

const { getDb } = require('../../server/db/database');

describe('pattern-rotation', () => {
  describe('パターン定義', () => {
    test('冒頭パターンが5種類定義されている', () => {
      const keys = Object.keys(OPENING_PATTERNS);
      expect(keys).toEqual(['O-A', 'O-B', 'O-C', 'O-D', 'O-E']);
      expect(keys).toHaveLength(5);
    });

    test('展開パターンが4種類定義されている', () => {
      const keys = Object.keys(DEVELOPMENT_PATTERNS);
      expect(keys).toEqual(['D-A', 'D-B', 'D-C', 'D-D']);
      expect(keys).toHaveLength(4);
    });

    test('締めパターンが4種類定義されている', () => {
      const keys = Object.keys(CLOSING_PATTERNS);
      expect(keys).toEqual(['C-A', 'C-B', 'C-C', 'C-D']);
      expect(keys).toHaveLength(4);
    });

    test('各パターンに name と description がある', () => {
      for (const patterns of [OPENING_PATTERNS, DEVELOPMENT_PATTERNS, CLOSING_PATTERNS]) {
        for (const [code, pattern] of Object.entries(patterns)) {
          expect(pattern).toHaveProperty('name');
          expect(pattern).toHaveProperty('description');
          expect(typeof pattern.name).toBe('string');
          expect(typeof pattern.description).toBe('string');
          expect(pattern.name.length).toBeGreaterThan(0);
          expect(pattern.description.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('computeConstraints', () => {
    test('空の履歴では制約なし', () => {
      const result = computeConstraints([]);
      expect(result.forbiddenOpening).toEqual([]);
      expect(result.forbiddenDevelopment).toEqual([]);
      expect(result.forbiddenClosing).toEqual([]);
      expect(result.avoidExpressions).toEqual([]);
    });

    test('直近2件と同じ冒頭パターンは使用禁止', () => {
      const history = [
        { opening_pattern: 'O-A', development_pattern: 'D-A', closing_pattern: 'C-A', expressions: [] },
        { opening_pattern: 'O-B', development_pattern: 'D-B', closing_pattern: 'C-B', expressions: [] },
      ];
      const result = computeConstraints(history);
      expect(result.forbiddenOpening).toContain('O-A');
      expect(result.forbiddenOpening).toContain('O-B');
      expect(result.forbiddenOpening).toHaveLength(2);
    });

    test('3件目の冒頭パターンは禁止されない', () => {
      const history = [
        { opening_pattern: 'O-A', development_pattern: 'D-A', closing_pattern: 'C-A', expressions: [] },
        { opening_pattern: 'O-B', development_pattern: 'D-B', closing_pattern: 'C-B', expressions: [] },
        { opening_pattern: 'O-C', development_pattern: 'D-C', closing_pattern: 'C-C', expressions: [] },
      ];
      const result = computeConstraints(history);
      expect(result.forbiddenOpening).not.toContain('O-C');
    });

    test('直近3件で2回以上使われた展開パターンは使用禁止', () => {
      const history = [
        { opening_pattern: 'O-A', development_pattern: 'D-A', closing_pattern: 'C-A', expressions: [] },
        { opening_pattern: 'O-B', development_pattern: 'D-A', closing_pattern: 'C-B', expressions: [] },
        { opening_pattern: 'O-C', development_pattern: 'D-B', closing_pattern: 'C-C', expressions: [] },
      ];
      const result = computeConstraints(history);
      expect(result.forbiddenDevelopment).toContain('D-A');
      expect(result.forbiddenDevelopment).not.toContain('D-B');
    });

    test('直近3件で1回だけの展開パターンは禁止されない', () => {
      const history = [
        { opening_pattern: 'O-A', development_pattern: 'D-A', closing_pattern: 'C-A', expressions: [] },
        { opening_pattern: 'O-B', development_pattern: 'D-B', closing_pattern: 'C-B', expressions: [] },
        { opening_pattern: 'O-C', development_pattern: 'D-C', closing_pattern: 'C-C', expressions: [] },
      ];
      const result = computeConstraints(history);
      expect(result.forbiddenDevelopment).toEqual([]);
    });

    test('直近2件と同じ締めパターンは使用禁止', () => {
      const history = [
        { opening_pattern: 'O-A', development_pattern: 'D-A', closing_pattern: 'C-C', expressions: [] },
        { opening_pattern: 'O-B', development_pattern: 'D-B', closing_pattern: 'C-D', expressions: [] },
      ];
      const result = computeConstraints(history);
      expect(result.forbiddenClosing).toContain('C-C');
      expect(result.forbiddenClosing).toContain('C-D');
    });

    test('直近5件のexpressionsを回避リストに含める', () => {
      const history = [
        { opening_pattern: 'O-A', development_pattern: 'D-A', closing_pattern: 'C-A', expressions: ['TOEIC950'] },
        { opening_pattern: 'O-B', development_pattern: 'D-B', closing_pattern: 'C-B', expressions: ['500回以上'] },
        { opening_pattern: 'O-C', development_pattern: 'D-C', closing_pattern: 'C-C', expressions: ['浅草の雷門'] },
        { opening_pattern: 'O-D', development_pattern: 'D-D', closing_pattern: 'C-D', expressions: ['レビュー4.86'] },
        { opening_pattern: 'O-E', development_pattern: 'D-A', closing_pattern: 'C-A', expressions: ['VIPツアー'] },
      ];
      const result = computeConstraints(history);
      expect(result.avoidExpressions).toContain('TOEIC950');
      expect(result.avoidExpressions).toContain('500回以上');
      expect(result.avoidExpressions).toContain('浅草の雷門');
      expect(result.avoidExpressions).toContain('レビュー4.86');
      expect(result.avoidExpressions).toContain('VIPツアー');
    });

    test('expressionsの重複は除去される', () => {
      const history = [
        { opening_pattern: 'O-A', development_pattern: 'D-A', closing_pattern: 'C-A', expressions: ['TOEIC950', '500回以上'] },
        { opening_pattern: 'O-B', development_pattern: 'D-B', closing_pattern: 'C-B', expressions: ['TOEIC950'] },
      ];
      const result = computeConstraints(history);
      const toeicCount = result.avoidExpressions.filter(e => e === 'TOEIC950').length;
      expect(toeicCount).toBe(1);
    });

    test('null のパターン値は無視される', () => {
      const history = [
        { opening_pattern: null, development_pattern: null, closing_pattern: null, expressions: null },
        { opening_pattern: 'O-A', development_pattern: null, closing_pattern: 'C-A', expressions: [] },
      ];
      const result = computeConstraints(history);
      expect(result.forbiddenOpening).toEqual(['O-A']);
      expect(result.forbiddenDevelopment).toEqual([]);
      expect(result.forbiddenClosing).toEqual(['C-A']);
      expect(result.avoidExpressions).toEqual([]);
    });

    test('履歴が1件の場合でもルールが正しく適用される', () => {
      const history = [
        { opening_pattern: 'O-D', development_pattern: 'D-C', closing_pattern: 'C-B', expressions: ['心構え'] },
      ];
      const result = computeConstraints(history);
      expect(result.forbiddenOpening).toEqual(['O-D']);
      expect(result.forbiddenDevelopment).toEqual([]);
      expect(result.forbiddenClosing).toEqual(['C-B']);
      expect(result.avoidExpressions).toEqual(['心構え']);
    });
  });

  describe('getAvailablePatterns', () => {
    test('制約がない場合、全パターンが利用可能', () => {
      const constraints = {
        forbiddenOpening: [],
        forbiddenDevelopment: [],
        forbiddenClosing: [],
        avoidExpressions: []
      };
      const available = getAvailablePatterns(constraints);
      expect(available.opening).toEqual(['O-A', 'O-B', 'O-C', 'O-D', 'O-E']);
      expect(available.development).toEqual(['D-A', 'D-B', 'D-C', 'D-D']);
      expect(available.closing).toEqual(['C-A', 'C-B', 'C-C', 'C-D']);
    });

    test('禁止パターンが除外される', () => {
      const constraints = {
        forbiddenOpening: ['O-A', 'O-B'],
        forbiddenDevelopment: ['D-A'],
        forbiddenClosing: ['C-C', 'C-D'],
        avoidExpressions: []
      };
      const available = getAvailablePatterns(constraints);
      expect(available.opening).toEqual(['O-C', 'O-D', 'O-E']);
      expect(available.development).toEqual(['D-B', 'D-C', 'D-D']);
      expect(available.closing).toEqual(['C-A', 'C-B']);
    });

    test('全パターンが禁止された場合、全パターンにフォールバック', () => {
      const constraints = {
        forbiddenOpening: ['O-A', 'O-B', 'O-C', 'O-D', 'O-E'],
        forbiddenDevelopment: ['D-A', 'D-B', 'D-C', 'D-D'],
        forbiddenClosing: ['C-A', 'C-B', 'C-C', 'C-D'],
        avoidExpressions: []
      };
      const available = getAvailablePatterns(constraints);
      expect(available.opening).toEqual(['O-A', 'O-B', 'O-C', 'O-D', 'O-E']);
      expect(available.development).toEqual(['D-A', 'D-B', 'D-C', 'D-D']);
      expect(available.closing).toEqual(['C-A', 'C-B', 'C-C', 'C-D']);
    });

    test('選択肢が1つだけ残る場合はそれを返す', () => {
      const constraints = {
        forbiddenOpening: ['O-A', 'O-B', 'O-C', 'O-D'],
        forbiddenDevelopment: [],
        forbiddenClosing: [],
        avoidExpressions: []
      };
      const available = getAvailablePatterns(constraints);
      expect(available.opening).toEqual(['O-E']);
    });
  });

  describe('buildConstraintPromptBlock', () => {
    test('制約がない場合は空文字を返す', () => {
      const constraints = {
        forbiddenOpening: [],
        forbiddenDevelopment: [],
        forbiddenClosing: [],
        avoidExpressions: []
      };
      const result = buildConstraintPromptBlock(constraints);
      expect(result).toBe('');
    });

    test('冒頭の禁止パターンがプロンプトに含まれる', () => {
      const constraints = {
        forbiddenOpening: ['O-A'],
        forbiddenDevelopment: [],
        forbiddenClosing: [],
        avoidExpressions: []
      };
      const result = buildConstraintPromptBlock(constraints);
      expect(result).toContain('パターン制約');
      expect(result).toContain('冒頭で使用禁止');
      expect(result).toContain('O-A');
      expect(result).toContain('ゲストのセリフ');
    });

    test('展開の禁止パターンがプロンプトに含まれる', () => {
      const constraints = {
        forbiddenOpening: [],
        forbiddenDevelopment: ['D-B'],
        forbiddenClosing: [],
        avoidExpressions: []
      };
      const result = buildConstraintPromptBlock(constraints);
      expect(result).toContain('展開で使用禁止');
      expect(result).toContain('D-B');
      expect(result).toContain('エピソード深掘り');
    });

    test('締めの禁止パターンがプロンプトに含まれる', () => {
      const constraints = {
        forbiddenOpening: [],
        forbiddenDevelopment: [],
        forbiddenClosing: ['C-A', 'C-C'],
        avoidExpressions: []
      };
      const result = buildConstraintPromptBlock(constraints);
      expect(result).toContain('締めで使用禁止');
      expect(result).toContain('C-A');
      expect(result).toContain('断言');
      expect(result).toContain('C-C');
      expect(result).toContain('余韻');
    });

    test('避けるべき表現がプロンプトに含まれる', () => {
      const constraints = {
        forbiddenOpening: [],
        forbiddenDevelopment: [],
        forbiddenClosing: [],
        avoidExpressions: ['TOEIC950', '500回以上']
      };
      const result = buildConstraintPromptBlock(constraints);
      expect(result).toContain('避けるべき表現');
      expect(result).toContain('TOEIC950');
      expect(result).toContain('500回以上');
    });

    test('すべての制約がある場合、すべてプロンプトに含まれる', () => {
      const constraints = {
        forbiddenOpening: ['O-A', 'O-B'],
        forbiddenDevelopment: ['D-A'],
        forbiddenClosing: ['C-C'],
        avoidExpressions: ['浅草の雷門']
      };
      const result = buildConstraintPromptBlock(constraints);
      expect(result).toContain('冒頭で使用禁止');
      expect(result).toContain('展開で使用禁止');
      expect(result).toContain('締めで使用禁止');
      expect(result).toContain('避けるべき表現');
    });

    test('未知のパターンコードでもエラーにならない', () => {
      const constraints = {
        forbiddenOpening: ['O-Z'],
        forbiddenDevelopment: [],
        forbiddenClosing: [],
        avoidExpressions: []
      };
      const result = buildConstraintPromptBlock(constraints);
      expect(result).toContain('O-Z');
    });
  });

  describe('getRecentPatternHistory', () => {
    test('DB取得成功時はデータを返す', async () => {
      const mockData = [
        { opening_pattern: 'O-A', development_pattern: 'D-B', closing_pattern: 'C-A', expressions: ['test'] },
      ];
      const mockLimit = jest.fn().mockResolvedValue({ data: mockData, error: null });
      const mockOrder = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockEq = jest.fn().mockReturnValue({ order: mockOrder });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

      getDb.mockReturnValue({
        from: jest.fn().mockReturnValue({ select: mockSelect })
      });

      const result = await getRecentPatternHistory('account-1');
      expect(result).toEqual(mockData);
    });

    test('DBエラー時は空配列を返す', async () => {
      const mockLimit = jest.fn().mockResolvedValue({ data: null, error: { message: 'table not found' } });
      const mockOrder = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockEq = jest.fn().mockReturnValue({ order: mockOrder });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

      getDb.mockReturnValue({
        from: jest.fn().mockReturnValue({ select: mockSelect })
      });

      const result = await getRecentPatternHistory('account-1');
      expect(result).toEqual([]);
    });

    test('例外発生時は空配列を返す', async () => {
      getDb.mockImplementation(() => { throw new Error('connection failed'); });

      const result = await getRecentPatternHistory('account-1');
      expect(result).toEqual([]);
    });
  });

  describe('logPatternUsage', () => {
    test('パターン情報をDBに保存する', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      getDb.mockReturnValue({
        from: jest.fn().mockReturnValue({ insert: mockInsert })
      });

      await logPatternUsage('account-1', {
        openingPattern: 'O-A',
        developmentPattern: 'D-B',
        closingPattern: 'C-C',
        expressions: ['テスト表現']
      });

      expect(mockInsert).toHaveBeenCalledWith({
        account_id: 'account-1',
        opening_pattern: 'O-A',
        development_pattern: 'D-B',
        closing_pattern: 'C-C',
        expressions: ['テスト表現']
      });
    });

    test('DB保存失敗時もエラーを投げない', async () => {
      getDb.mockImplementation(() => { throw new Error('connection failed'); });

      await expect(
        logPatternUsage('account-1', {
          openingPattern: 'O-A',
          developmentPattern: 'D-B',
          closingPattern: 'C-C',
          expressions: []
        })
      ).resolves.not.toThrow();
    });

    test('null値でも正しく保存される', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      getDb.mockReturnValue({
        from: jest.fn().mockReturnValue({ insert: mockInsert })
      });

      await logPatternUsage('account-1', {
        openingPattern: null,
        developmentPattern: null,
        closingPattern: null,
        expressions: []
      });

      expect(mockInsert).toHaveBeenCalledWith({
        account_id: 'account-1',
        opening_pattern: null,
        development_pattern: null,
        closing_pattern: null,
        expressions: []
      });
    });
  });

  describe('getPatternConstraintBlock', () => {
    test('履歴がない場合は空文字を返す', async () => {
      const mockLimit = jest.fn().mockResolvedValue({ data: [], error: null });
      const mockOrder = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockEq = jest.fn().mockReturnValue({ order: mockOrder });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

      getDb.mockReturnValue({
        from: jest.fn().mockReturnValue({ select: mockSelect })
      });

      const result = await getPatternConstraintBlock('account-1');
      expect(result).toBe('');
    });

    test('履歴がある場合は制約ブロックを返す', async () => {
      const mockData = [
        { opening_pattern: 'O-A', development_pattern: 'D-B', closing_pattern: 'C-A', expressions: ['テスト'] },
        { opening_pattern: 'O-C', development_pattern: 'D-B', closing_pattern: 'C-C', expressions: ['表現'] },
      ];
      const mockLimit = jest.fn().mockResolvedValue({ data: mockData, error: null });
      const mockOrder = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockEq = jest.fn().mockReturnValue({ order: mockOrder });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

      getDb.mockReturnValue({
        from: jest.fn().mockReturnValue({ select: mockSelect })
      });

      const result = await getPatternConstraintBlock('account-1');
      expect(result).toContain('パターン制約');
      expect(result).toContain('O-A');
      expect(result).toContain('O-C');
      expect(result).toContain('D-B'); // 2回使われたので禁止
    });
  });

  describe('制約ルールの統合テスト', () => {
    test('典型的な5件の履歴に対して正しい制約が計算される', () => {
      const history = [
        { opening_pattern: 'O-D', development_pattern: 'D-C', closing_pattern: 'C-B', expressions: ['心構え', '30分'] },
        { opening_pattern: 'O-A', development_pattern: 'D-B', closing_pattern: 'C-A', expressions: ['ゲストの笑顔'] },
        { opening_pattern: 'O-B', development_pattern: 'D-C', closing_pattern: 'C-D', expressions: ['浅草', '朝8時'] },
        { opening_pattern: 'O-E', development_pattern: 'D-A', closing_pattern: 'C-C', expressions: ['文化の違い'] },
        { opening_pattern: 'O-C', development_pattern: 'D-D', closing_pattern: 'C-B', expressions: ['TOEIC'] },
      ];

      const constraints = computeConstraints(history);

      // 冒頭: 直近2件 = O-D, O-A → 禁止
      expect(constraints.forbiddenOpening).toContain('O-D');
      expect(constraints.forbiddenOpening).toContain('O-A');
      expect(constraints.forbiddenOpening).not.toContain('O-B');

      // 展開: 直近3件で D-C が2回 → 禁止
      expect(constraints.forbiddenDevelopment).toContain('D-C');
      expect(constraints.forbiddenDevelopment).not.toContain('D-B');

      // 締め: 直近2件 = C-B, C-A → 禁止
      expect(constraints.forbiddenClosing).toContain('C-B');
      expect(constraints.forbiddenClosing).toContain('C-A');

      // 表現: 5件全部の表現を含む
      expect(constraints.avoidExpressions).toContain('心構え');
      expect(constraints.avoidExpressions).toContain('TOEIC');
      expect(constraints.avoidExpressions).toContain('浅草');

      // 利用可能パターンの確認
      const available = getAvailablePatterns(constraints);
      expect(available.opening).toEqual(['O-B', 'O-C', 'O-E']);
      expect(available.development).toEqual(['D-A', 'D-B', 'D-D']);
      expect(available.closing).toEqual(['C-C', 'C-D']);
    });
  });
});
