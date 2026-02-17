// Mock database
const mockInsert = jest.fn().mockResolvedValue({ error: null });
const mockDelete = jest.fn(() => mockChain);
const mockSelect = jest.fn(() => mockChain);
const mockEq = jest.fn(() => mockChain);
const mockOrder = jest.fn(() => mockChain);
const mockRange = jest.fn().mockResolvedValue({ data: [], error: null });
const mockLt = jest.fn().mockResolvedValue({ error: null });

const mockChain = {
  select: mockSelect,
  insert: mockInsert,
  delete: mockDelete,
  eq: mockEq,
  order: mockOrder,
  range: mockRange,
  lt: mockLt,
  then: jest.fn((resolve) => resolve({ data: null, error: null, count: 0 })),
};

const mockFrom = jest.fn(() => mockChain);

jest.mock('../../server/db/database', () => ({
  getDb: jest.fn(() => ({ from: mockFrom }))
}));

const { log, logError, logWarn, logInfo, getLogs, getLogCount, cleanOldLogs } = require('../../server/services/app-logger');

describe('app-logger service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
    mockSelect.mockImplementation(() => mockChain);
    mockEq.mockImplementation(() => mockChain);
    mockOrder.mockImplementation(() => mockChain);
    mockRange.mockResolvedValue({ data: [], error: null });
    mockLt.mockResolvedValue({ error: null });
    mockDelete.mockImplementation(() => mockChain);
    mockChain.then = jest.fn((resolve) => resolve({ data: null, error: null, count: 0 }));
  });

  describe('log()', () => {
    test('DBにログを書き込む', async () => {
      await log('error', 'api', 'テストエラー', { detail: 'test' });

      expect(mockFrom).toHaveBeenCalledWith('app_logs');
      expect(mockInsert).toHaveBeenCalledWith({
        level: 'error',
        category: 'api',
        message: 'テストエラー',
        details: { detail: 'test' }
      });
    });

    test('無効なレベルはinfoに変換される', async () => {
      await log('invalid', 'system', 'test');

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'info' })
      );
    });

    test('detailsがnullの場合はnullが渡される', async () => {
      await log('info', 'system', 'test');

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ details: null })
      );
    });

    test('DB書き込み失敗時はエラーを投げない', async () => {
      mockInsert.mockRejectedValueOnce(new Error('DB error'));
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(log('error', 'api', 'test')).resolves.not.toThrow();

      consoleSpy.mockRestore();
    });
  });

  describe('logError / logWarn / logInfo', () => {
    test('logError はlevel=errorでログを記録する', async () => {
      await logError('api', 'エラーメッセージ', { stack: 'trace' });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'error', category: 'api', message: 'エラーメッセージ' })
      );
    });

    test('logWarn はlevel=warnでログを記録する', async () => {
      await logWarn('system', '警告メッセージ');

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'warn', category: 'system' })
      );
    });

    test('logInfo はlevel=infoでログを記録する', async () => {
      await logInfo('batch', '情報メッセージ');

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'info', category: 'batch' })
      );
    });
  });

  describe('getLogs()', () => {
    test('フィルタなしでログを取得する', async () => {
      const mockLogs = [
        { id: 1, level: 'error', category: 'api', message: 'test', created_at: '2026-02-17T00:00:00Z' }
      ];
      mockRange.mockResolvedValueOnce({ data: mockLogs, error: null });

      const result = await getLogs({ limit: 100, offset: 0 });

      expect(mockFrom).toHaveBeenCalledWith('app_logs');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(mockRange).toHaveBeenCalledWith(0, 99);
      expect(result).toEqual(mockLogs);
    });

    test('レベルでフィルタできる', async () => {
      mockRange.mockResolvedValueOnce({ data: [], error: null });

      await getLogs({ level: 'error', limit: 50, offset: 0 });

      expect(mockEq).toHaveBeenCalledWith('level', 'error');
    });

    test('カテゴリでフィルタできる', async () => {
      mockRange.mockResolvedValueOnce({ data: [], error: null });

      await getLogs({ category: 'api', limit: 50, offset: 0 });

      expect(mockEq).toHaveBeenCalledWith('category', 'api');
    });

    test('エラー時は例外をスローする', async () => {
      mockRange.mockResolvedValueOnce({ data: null, error: new Error('query failed') });

      await expect(getLogs()).rejects.toThrow('query failed');
    });
  });

  describe('getLogCount()', () => {
    test('ログ件数を取得する', async () => {
      mockChain.then = jest.fn((resolve) => resolve({ count: 42, error: null }));

      const count = await getLogCount();

      expect(mockFrom).toHaveBeenCalledWith('app_logs');
      expect(mockSelect).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    });
  });

  describe('cleanOldLogs()', () => {
    test('指定日数より古いログを削除する', async () => {
      await cleanOldLogs(30);

      expect(mockFrom).toHaveBeenCalledWith('app_logs');
      expect(mockDelete).toHaveBeenCalled();
      expect(mockLt).toHaveBeenCalledWith('created_at', expect.any(String));
    });
  });
});
