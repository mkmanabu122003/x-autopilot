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

// Mock x-api
jest.mock('../../server/services/x-api', () => ({
  postTweet: jest.fn().mockResolvedValue({ data: { id: 'tweet-123' } }),
  logApiUsage: jest.fn().mockResolvedValue(undefined)
}));

// Mock ai-provider
jest.mock('../../server/services/ai-provider', () => ({
  getAIProvider: jest.fn(() => ({
    generateTweets: jest.fn().mockResolvedValue({
      provider: 'claude',
      model: 'claude-sonnet-4-20250514',
      candidates: [{ text: 'テスト投稿', label: 'テスト', hashtags: [] }]
    })
  })),
  AIProvider: jest.fn().mockImplementation(() => ({
    getTaskModelSettings: jest.fn().mockResolvedValue({ preferredProvider: 'claude' })
  }))
}));

// Mock analytics
jest.mock('../../server/services/analytics', () => ({
  getQuoteSuggestions: jest.fn().mockResolvedValue([]),
  getReplySuggestions: jest.fn().mockResolvedValue([]),
  getCompetitorContext: jest.fn().mockResolvedValue('')
}));

// Mock pattern-rotation
jest.mock('../../server/services/pattern-rotation', () => ({
  getPatternConstraintBlock: jest.fn().mockResolvedValue(''),
  logPatternUsage: jest.fn().mockResolvedValue(undefined)
}));

// Mock cost-calculator
jest.mock('../../server/services/cost-calculator', () => ({
  logDetailedUsage: jest.fn().mockResolvedValue(undefined),
  checkBudgetStatus: jest.fn().mockResolvedValue({ shouldPause: false })
}));

const { logAutoPostExecution, isTimeInWindow, getJSTNow, buildStyleInstruction, checkAndRunAutoPosts, SCHEDULE_WINDOW_MINUTES, JST_OFFSET_HOURS } = require('../../server/services/auto-poster');
const { getDb } = require('../../server/db/database');
const { getReplySuggestions } = require('../../server/services/analytics');

describe('auto-poster', () => {
  describe('getJSTNow', () => {
    test('currentTime は HH:MM 形式を返す', () => {
      const { currentTime } = getJSTNow();
      expect(currentTime).toMatch(/^\d{2}:\d{2}$/);
    });

    test('today は YYYY-MM-DD 形式を返す', () => {
      const { today } = getJSTNow();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('now は Date オブジェクトを返す', () => {
      const { now } = getJSTNow();
      expect(now).toBeInstanceOf(Date);
    });

    test('UTC サーバーでも JST 時刻を正しく返す（UTC+9時間のオフセット）', () => {
      const { currentTime, now } = getJSTNow();
      const [h, m] = currentTime.split(':').map(Number);
      // JST = UTC + 9h
      const jstMs = now.getTime() + JST_OFFSET_HOURS * 60 * 60 * 1000;
      const jst = new Date(jstMs);
      expect(h).toBe(jst.getUTCHours());
      expect(m).toBe(jst.getUTCMinutes());
    });

    test('JST の日付が正しい（UTC 15:00以降は翌日）', () => {
      const { today, now } = getJSTNow();
      const jstMs = now.getTime() + JST_OFFSET_HOURS * 60 * 60 * 1000;
      const jst = new Date(jstMs);
      const expectedDate = jst.toISOString().slice(0, 10);
      expect(today).toBe(expectedDate);
    });

    test('JST_OFFSET_HOURS は9（UTC+9）', () => {
      expect(JST_OFFSET_HOURS).toBe(9);
    });

    test('UTC 11:50 のとき JST 20:50 を返す', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-18T11:50:00Z'));
      const { currentTime, today } = getJSTNow();
      expect(currentTime).toBe('20:50');
      expect(today).toBe('2026-02-18');
      jest.useRealTimers();
    });

    test('UTC 20:50 のとき JST 05:50（翌日）を返す', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-18T20:50:00Z'));
      const { currentTime, today } = getJSTNow();
      expect(currentTime).toBe('05:50');
      expect(today).toBe('2026-02-19');
      jest.useRealTimers();
    });

    test('UTC 15:00 のとき JST 00:00（翌日）を返す', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-18T15:00:00Z'));
      const { currentTime, today } = getJSTNow();
      expect(currentTime).toBe('00:00');
      expect(today).toBe('2026-02-19');
      jest.useRealTimers();
    });

    test('UTC 14:59 のとき JST 23:59（同日）を返す', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-18T14:59:00Z'));
      const { currentTime, today } = getJSTNow();
      expect(currentTime).toBe('23:59');
      expect(today).toBe('2026-02-18');
      jest.useRealTimers();
    });
  });

  describe('isTimeInWindow', () => {
    test('完全一致はマッチする', () => {
      expect(isTimeInWindow('20:50', '20:50')).toBe(true);
    });

    test('ウィンドウ内（+1分）はマッチする', () => {
      expect(isTimeInWindow('20:50', '20:51')).toBe(true);
    });

    test('ウィンドウ内（+4分）はマッチする', () => {
      expect(isTimeInWindow('20:50', '20:54')).toBe(true);
    });

    test('ウィンドウ外（+5分）はマッチしない', () => {
      expect(isTimeInWindow('20:50', '20:55')).toBe(false);
    });

    test('設定時刻より前はマッチしない', () => {
      expect(isTimeInWindow('20:50', '20:49')).toBe(false);
    });

    test('大幅にずれている場合はマッチしない', () => {
      expect(isTimeInWindow('20:50', '21:00')).toBe(false);
    });

    test('深夜帯の時刻でも正しく動作する', () => {
      expect(isTimeInWindow('23:58', '23:59')).toBe(true);
    });

    test('深夜のラップアラウンド: 23:58設定で00:01はウィンドウ内', () => {
      expect(isTimeInWindow('23:58', '00:01')).toBe(true);
    });

    test('深夜のラップアラウンド: 23:58設定で00:05はウィンドウ外', () => {
      expect(isTimeInWindow('23:58', '00:05')).toBe(false);
    });

    test('カスタムウィンドウ幅を指定できる', () => {
      expect(isTimeInWindow('09:00', '09:09', 10)).toBe(true);
      expect(isTimeInWindow('09:00', '09:10', 10)).toBe(false);
    });

    test('09:08設定で09:10（cron-job.org 5分間隔）はマッチする', () => {
      expect(isTimeInWindow('09:08', '09:10')).toBe(true);
    });

    test('09:08設定で09:05はマッチしない（設定時刻より前）', () => {
      expect(isTimeInWindow('09:08', '09:05')).toBe(false);
    });

    test('SCHEDULE_WINDOW_MINUTES のデフォルトは5', () => {
      expect(SCHEDULE_WINDOW_MINUTES).toBe(5);
    });
  });

  describe('buildStyleInstruction', () => {
    test('すべてのスタイル設定がある場合、トーン・ターゲット・補足を含む文字列を返す', () => {
      const result = buildStyleInstruction({
        tone: 'カジュアル',
        target_audience: 'インバウンド事業者',
        style_note: '浅草エリアの話題を多めに'
      });
      expect(result).toContain('トーン: カジュアル');
      expect(result).toContain('ターゲット: インバウンド事業者');
      expect(result).toContain('補足: 浅草エリアの話題を多めに');
    });

    test('スタイル設定が空の場合、空文字を返す', () => {
      const result = buildStyleInstruction({ tone: '', target_audience: '', style_note: '' });
      expect(result).toBe('');
    });

    test('一部のスタイル設定のみの場合、設定されたもののみ含む', () => {
      const result = buildStyleInstruction({ tone: 'フレンドリー', target_audience: '', style_note: '' });
      expect(result).toContain('トーン: フレンドリー');
      expect(result).not.toContain('ターゲット');
      expect(result).not.toContain('補足');
    });

    test('スタイル設定フィールドがundefinedの場合、空文字を返す', () => {
      const result = buildStyleInstruction({});
      expect(result).toBe('');
    });
  });

  describe('checkAndRunAutoPosts（結合テスト）', () => {
    // Helper: create a mock DB that returns the given settings on select, tracks update/insert calls
    function setupMockDb(settings) {
      const insertCalls = [];
      const updateCalls = [];
      const mockFrom = jest.fn((table) => {
        if (table === 'auto_post_settings') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: settings, error: null })
            }),
            update: jest.fn((data) => {
              updateCalls.push({ table, data });
              return { eq: jest.fn().mockResolvedValue({ error: null }) };
            })
          };
        }
        // my_posts, auto_post_logs etc.
        return {
          insert: jest.fn((data) => {
            insertCalls.push({ table, data });
            return Promise.resolve({ error: null });
          })
        };
      });
      getDb.mockReturnValue({ from: mockFrom });
      return { insertCalls, updateCalls };
    }

    afterEach(() => {
      jest.useRealTimers();
    });

    test('UTC 11:50 (= JST 20:50) で schedule_times "20:50" のリプライ設定が実行される', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-18T11:50:00Z'));

      getReplySuggestions.mockResolvedValueOnce([
        { tweet_id: 'tw-1', text: 'ターゲットツイート', handle: 'rival' }
      ]);

      const { updateCalls, insertCalls } = setupMockDb([{
        id: 'setting-reply',
        account_id: 'account-1',
        post_type: 'reply',
        enabled: true,
        schedule_times: '20:50',
        posts_per_day: 1,
        schedule_mode: 'immediate',
        last_run_date: null,
        last_run_times: '',
        x_accounts: { display_name: 'Test', handle: 'test', default_ai_provider: 'claude' }
      }]);

      await checkAndRunAutoPosts();

      // last_run_times に "20:50" が記録される
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].data).toEqual({
        last_run_date: '2026-02-18',
        last_run_times: '20:50'
      });
    });

    test('UTC 11:50 (= JST 20:50) で schedule_times "20:50" の新規ツイート設定が実行される', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-18T11:50:00Z'));

      const { updateCalls, insertCalls } = setupMockDb([{
        id: 'setting-new',
        account_id: 'account-1',
        post_type: 'new',
        enabled: true,
        schedule_times: '20:50',
        posts_per_day: 1,
        schedule_mode: 'immediate',
        themes: 'AI,プログラミング',
        last_run_date: null,
        last_run_times: '',
        x_accounts: { display_name: 'Test', handle: 'test', default_ai_provider: 'claude' }
      }]);

      await checkAndRunAutoPosts();

      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].data).toEqual({
        last_run_date: '2026-02-18',
        last_run_times: '20:50'
      });
      // my_posts への insert が呼ばれている（投稿 + ログ）
      const postInserts = insertCalls.filter(c => c.table === 'my_posts');
      expect(postInserts.length).toBeGreaterThanOrEqual(1);
    });

    test('UTC 11:50 (= JST 20:50) で schedule_times "20:50" の引用RT設定が実行される', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-18T11:50:00Z'));

      const { getQuoteSuggestions } = require('../../server/services/analytics');
      getQuoteSuggestions.mockResolvedValueOnce([
        { tweet_id: 'tw-q1', text: '引用対象ツイート', handle: 'competitor' }
      ]);

      const { updateCalls } = setupMockDb([{
        id: 'setting-quote',
        account_id: 'account-1',
        post_type: 'quote',
        enabled: true,
        schedule_times: '20:50',
        posts_per_day: 1,
        schedule_mode: 'immediate',
        last_run_date: null,
        last_run_times: '',
        x_accounts: { display_name: 'Test', handle: 'test', default_ai_provider: 'claude' }
      }]);

      await checkAndRunAutoPosts();

      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].data).toEqual({
        last_run_date: '2026-02-18',
        last_run_times: '20:50'
      });
    });

    test('UTC 11:52 (= JST 20:52) でも schedule_times "20:50" がウィンドウ内で実行される', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-18T11:52:00Z'));

      getReplySuggestions.mockResolvedValueOnce([
        { tweet_id: 'tw-2', text: 'ターゲット', handle: 'rival' }
      ]);

      const { updateCalls } = setupMockDb([{
        id: 'setting-reply',
        account_id: 'account-1',
        post_type: 'reply',
        enabled: true,
        schedule_times: '20:50',
        posts_per_day: 1,
        schedule_mode: 'immediate',
        last_run_date: null,
        last_run_times: '',
        x_accounts: { display_name: 'Test', handle: 'test', default_ai_provider: 'claude' }
      }]);

      await checkAndRunAutoPosts();

      // ウィンドウ内（+2分）なので実行される
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].data.last_run_times).toBe('20:50');
    });

    test('UTC 12:00 (= JST 21:00) では schedule_times "20:50" はウィンドウ外で実行されない', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-18T12:00:00Z'));

      const { updateCalls } = setupMockDb([{
        id: 'setting-reply',
        account_id: 'account-1',
        post_type: 'reply',
        enabled: true,
        schedule_times: '20:50',
        posts_per_day: 1,
        schedule_mode: 'immediate',
        last_run_date: null,
        last_run_times: '',
        x_accounts: { display_name: 'Test', handle: 'test', default_ai_provider: 'claude' }
      }]);

      await checkAndRunAutoPosts();

      // 10分ずれているので実行されない
      expect(updateCalls).toHaveLength(0);
    });

    test('UTC 20:50 (= JST 05:50翌日) では "20:50" はマッチしない（旧バグのシナリオ）', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-18T20:50:00Z'));

      const { updateCalls } = setupMockDb([{
        id: 'setting-reply',
        account_id: 'account-1',
        post_type: 'reply',
        enabled: true,
        schedule_times: '20:50',
        posts_per_day: 1,
        schedule_mode: 'immediate',
        last_run_date: null,
        last_run_times: '',
        x_accounts: { display_name: 'Test', handle: 'test', default_ai_provider: 'claude' }
      }]);

      await checkAndRunAutoPosts();

      // JST では 05:50 なので 20:50 とはマッチしない
      expect(updateCalls).toHaveLength(0);
    });

    test('同日の同時刻が既に実行済みの場合は重複実行しない', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-18T11:52:00Z'));

      const { updateCalls } = setupMockDb([{
        id: 'setting-reply',
        account_id: 'account-1',
        post_type: 'reply',
        enabled: true,
        schedule_times: '20:50',
        posts_per_day: 1,
        schedule_mode: 'immediate',
        last_run_date: '2026-02-18',
        last_run_times: '20:50',
        x_accounts: { display_name: 'Test', handle: 'test', default_ai_provider: 'claude' }
      }]);

      await checkAndRunAutoPosts();

      // 既に実行済みなのでスキップ
      expect(updateCalls).toHaveLength(0);
    });

    test('schedule_mode が "draft" の新規ツイートは下書きとして保存される', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-18T11:50:00Z'));

      const { updateCalls, insertCalls } = setupMockDb([{
        id: 'setting-new-draft',
        account_id: 'account-1',
        post_type: 'new',
        enabled: true,
        schedule_times: '20:50',
        posts_per_day: 1,
        schedule_mode: 'draft',
        themes: 'AI,プログラミング',
        last_run_date: null,
        last_run_times: '',
        x_accounts: { display_name: 'Test', handle: 'test', default_ai_provider: 'claude' }
      }]);

      await checkAndRunAutoPosts();

      expect(updateCalls).toHaveLength(1);
      // my_posts への insert で status が 'draft' であること
      const postInserts = insertCalls.filter(c => c.table === 'my_posts');
      expect(postInserts.length).toBeGreaterThanOrEqual(1);
      expect(postInserts[0].data.status).toBe('draft');
    });

    test('schedule_mode が "draft" のリプライは下書きとして保存される', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-18T11:50:00Z'));

      getReplySuggestions.mockResolvedValueOnce([
        { tweet_id: 'tw-draft', text: 'ターゲットツイート', handle: 'rival' }
      ]);

      const { updateCalls, insertCalls } = setupMockDb([{
        id: 'setting-reply-draft',
        account_id: 'account-1',
        post_type: 'reply',
        enabled: true,
        schedule_times: '20:50',
        posts_per_day: 1,
        schedule_mode: 'draft',
        last_run_date: null,
        last_run_times: '',
        x_accounts: { display_name: 'Test', handle: 'test', default_ai_provider: 'claude' }
      }]);

      await checkAndRunAutoPosts();

      expect(updateCalls).toHaveLength(1);
      const postInserts = insertCalls.filter(c => c.table === 'my_posts');
      expect(postInserts.length).toBeGreaterThanOrEqual(1);
      expect(postInserts[0].data.status).toBe('draft');
    });

    test('schedule_mode が "draft" の引用RTは下書きとして保存される', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-18T11:50:00Z'));

      const { getQuoteSuggestions } = require('../../server/services/analytics');
      getQuoteSuggestions.mockResolvedValueOnce([
        { tweet_id: 'tw-qdraft', text: '引用対象ツイート', handle: 'competitor' }
      ]);

      const { updateCalls, insertCalls } = setupMockDb([{
        id: 'setting-quote-draft',
        account_id: 'account-1',
        post_type: 'quote',
        enabled: true,
        schedule_times: '20:50',
        posts_per_day: 1,
        schedule_mode: 'draft',
        last_run_date: null,
        last_run_times: '',
        x_accounts: { display_name: 'Test', handle: 'test', default_ai_provider: 'claude' }
      }]);

      await checkAndRunAutoPosts();

      expect(updateCalls).toHaveLength(1);
      const postInserts = insertCalls.filter(c => c.table === 'my_posts');
      expect(postInserts.length).toBeGreaterThanOrEqual(1);
      expect(postInserts[0].data.status).toBe('draft');
    });

    test('複数の schedule_times で該当するスロットだけ実行される', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-18T04:00:00Z')); // JST 13:00

      getReplySuggestions.mockResolvedValueOnce([
        { tweet_id: 'tw-3', text: 'ターゲット', handle: 'rival' }
      ]);

      const { updateCalls } = setupMockDb([{
        id: 'setting-multi',
        account_id: 'account-1',
        post_type: 'reply',
        enabled: true,
        schedule_times: '09:00,13:00,20:50',
        posts_per_day: 3,
        schedule_mode: 'immediate',
        last_run_date: '2026-02-18',
        last_run_times: '09:00',
        x_accounts: { display_name: 'Test', handle: 'test', default_ai_provider: 'claude' }
      }]);

      await checkAndRunAutoPosts();

      // 13:00 が JST 現在時刻とマッチし、09:00 は既実行済み、20:50 はまだ
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].data.last_run_times).toBe('09:00,13:00');
    });
  });

  describe('logAutoPostExecution', () => {
    test('下書き作成時に error_message が null で記録される', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      getDb.mockReturnValue({
        from: jest.fn().mockReturnValue({ insert: mockInsert })
      });

      await logAutoPostExecution('account-1', 'new', 2, 0, 0, 'success', null);

      expect(mockInsert).toHaveBeenCalledWith({
        account_id: 'account-1',
        post_type: 'new',
        posts_generated: 2,
        posts_scheduled: 0,
        posts_posted: 0,
        status: 'success',
        error_message: null
      });
    });

    test('エラー時は error_message にエラー内容が記録される', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      getDb.mockReturnValue({
        from: jest.fn().mockReturnValue({ insert: mockInsert })
      });

      await logAutoPostExecution('account-1', 'new', 0, 0, 0, 'failed', 'テーマが設定されていません');

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          error_message: 'テーマが設定されていません'
        })
      );
    });
  });
});
