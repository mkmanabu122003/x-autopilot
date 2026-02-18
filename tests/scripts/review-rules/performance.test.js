const performanceRules = require('../../../scripts/review-rules/performance');

function findRule(id) {
  return performanceRules.find(r => r.id === id);
}

describe('パフォーマンスレビュールール', () => {
  describe('PERF001: unbounded-query', () => {
    const rule = findRule('PERF001');

    test('LIMIT なしのクエリを検出する', () => {
      const lines = [
        "const { data } = await sb.from('tweets').select('*');",
      ];
      const findings = rule.check(lines, 'server/routes/tweets.js');
      expect(findings.length).toBe(1);
    });

    test('.limit() があるクエリは検出しない', () => {
      const lines = [
        "const { data } = await sb.from('tweets').select('*').limit(10);",
      ];
      const findings = rule.check(lines, 'server/routes/tweets.js');
      expect(findings.length).toBe(0);
    });

    test('.single() があるクエリは検出しない', () => {
      const lines = [
        "const { data } = await sb.from('settings').select('value').eq('key', 'prompt').single();",
      ];
      const findings = rule.check(lines, 'server/routes/settings.js');
      expect(findings.length).toBe(0);
    });

    test('IDで絞り込むクエリは検出しない', () => {
      const lines = [
        "const { data } = await sb.from('tweets').select('*').eq('id', tweetId);",
      ];
      const findings = rule.check(lines, 'server/routes/tweets.js');
      expect(findings.length).toBe(0);
    });

    test('JS/TSファイル以外はスキップする', () => {
      const lines = [
        "SELECT * FROM tweets;",
      ];
      const findings = rule.check(lines, 'server/db/migrations/001.sql');
      expect(findings.length).toBe(0);
    });
  });

  describe('PERF002: n-plus-one-query', () => {
    const rule = findRule('PERF002');

    test('forループ内のDBクエリを検出する', () => {
      const lines = [
        'for (const id of ids) {',
        "  const { data } = await sb.from('tweets').select('*').eq('id', id);",
        '  results.push(data);',
        '}',
      ];
      const findings = rule.check(lines, 'server/services/tweets.js');
      expect(findings.length).toBe(1);
    });

    test('forEach 内のDBクエリを検出する', () => {
      const lines = [
        'items.forEach(async (item) => {',
        "  await db.from('logs').insert(item);",
        '});',
      ];
      const findings = rule.check(lines, 'server/services/logger.js');
      expect(findings.length).toBe(1);
    });

    test('ループ外のDBクエリは検出しない', () => {
      const lines = [
        "const { data } = await sb.from('tweets').select('*');",
        'for (const tweet of data) {',
        '  console.log(tweet.text);',
        '}',
      ];
      const findings = rule.check(lines, 'server/services/tweets.js');
      expect(findings.length).toBe(0);
    });

    test('ワンライナーのreduceコールバック後のDBクエリは検出しない', () => {
      const lines = [
        "const { data: usageRows } = await sb.from('api_usage_log').select('cost_usd').gte('created_at', start);",
        "const totalCost = (usageRows || []).reduce((sum, r) => sum + (r.cost_usd || 0), 0);",
        '',
        "const { data: budgetRow } = await sb.from('settings').select('value').eq('key', 'budget').single();",
      ];
      const findings = rule.check(lines, 'server/services/x-api.js');
      expect(findings.length).toBe(0);
    });

    test('ワンライナーのmapコールバック後のDBクエリは検出しない', () => {
      const lines = [
        "return Object.keys(params).sort().map(k => `${k}=${params[k]}`).join(', ');",
        '}',
        '',
        'async function logUsage() {',
        "  await sb.from('log').insert({ data: 'test' });",
        '}',
      ];
      const findings = rule.check(lines, 'server/services/x-api.js');
      expect(findings.length).toBe(0);
    });

    test('複数行のforEachコールバック内のDBクエリは検出する', () => {
      const lines = [
        'items.forEach(async (item) => {',
        "  await db.from('logs').insert(item);",
        '});',
      ];
      const findings = rule.check(lines, 'server/services/logger.js');
      expect(findings.length).toBe(1);
    });
  });

  describe('PERF003: missing-async-error-handling', () => {
    const rule = findRule('PERF003');

    test('routes/ 以外のファイルはスキップする', () => {
      const lines = [
        'router.get("/test", async (req, res) => {',
        '  const data = await fetchData();',
        '  res.json(data);',
        '});',
      ];
      const findings = rule.check(lines, 'server/services/ai.js');
      expect(findings.length).toBe(0);
    });

    test('try-catch がないasyncルートハンドラを検出する', () => {
      const lines = [
        'router.get("/test", async (req, res) => {',
        '  const data = await fetchData();',
        '  res.json(data);',
        '});',
      ];
      const findings = rule.check(lines, 'server/routes/test.js');
      expect(findings.length).toBe(1);
    });

    test('try-catch があるルートハンドラは検出しない', () => {
      const lines = [
        'router.get("/test", async (req, res) => {',
        '  try {',
        '    const data = await fetchData();',
        '    res.json(data);',
        '  } catch (e) {',
        '    res.status(500).json({ error: e.message });',
        '  }',
        '});',
      ];
      const findings = rule.check(lines, 'server/routes/test.js');
      expect(findings.length).toBe(0);
    });
  });

  describe('PERF004: sequential-await', () => {
    const rule = findRule('PERF004');

    test('独立した直列awaitを検出する', () => {
      const lines = [
        '  const users = await fetchUsers();',
        '  const posts = await fetchPosts();',
      ];
      const findings = rule.check(lines, 'server/services/data.js');
      expect(findings.length).toBe(1);
    });

    test('依存関係がある直列awaitは検出しない', () => {
      const lines = [
        '  const user = await fetchUser(id);',
        '  const posts = await fetchPosts(user.id);',
      ];
      const findings = rule.check(lines, 'server/services/data.js');
      expect(findings.length).toBe(0);
    });
  });

  describe('PERF006: sync-file-operation', () => {
    const rule = findRule('PERF006');

    test('同期ファイル操作を検出する', () => {
      const lines = [
        "const data = fs.readFileSync('config.json', 'utf-8');",
      ];
      const findings = rule.check(lines, 'server/config.js');
      expect(findings.length).toBe(1);
    });

    test('コメント内の同期操作は検出しない', () => {
      const lines = [
        '// fs.readFileSync は使わない',
      ];
      const findings = rule.check(lines, 'server/config.js');
      expect(findings.length).toBe(0);
    });
  });
});
