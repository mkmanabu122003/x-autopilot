const securityRules = require('../../../scripts/review-rules/security');

function findRule(id) {
  return securityRules.find(r => r.id === id);
}

describe('セキュリティレビュールール', () => {
  describe('SEC001: hardcoded-secret', () => {
    const rule = findRule('SEC001');

    test('ハードコードされたAPIキーを検出する', () => {
      const lines = [
        'const config = {',
        '  apiKey: "sk-abc123def456ghi789jkl012mno345pqr678",',
        '};',
      ];
      const findings = rule.check(lines, 'server/config.js');
      expect(findings.length).toBe(1);
      expect(findings[0].line).toBe(2);
    });

    test('process.env 経由のアクセスは検出しない', () => {
      const lines = [
        'const apiKey = process.env.CLAUDE_API_KEY;',
      ];
      const findings = rule.check(lines, 'server/config.js');
      expect(findings.length).toBe(0);
    });

    test('コメント行は検出しない', () => {
      const lines = [
        '// apiKey: "sk-abc123def456ghi789jkl012mno345pqr678"',
      ];
      const findings = rule.check(lines, 'server/config.js');
      expect(findings.length).toBe(0);
    });

    test('プレースホルダー値は検出しない', () => {
      const lines = [
        'const apiKey = "your_api_key_here";',
      ];
      const findings = rule.check(lines, '.env.example');
      expect(findings.length).toBe(0);
    });
  });

  describe('SEC002: eval-usage', () => {
    const rule = findRule('SEC002');

    test('eval() の使用を検出する', () => {
      const lines = ['const result = eval(userInput);'];
      const findings = rule.check(lines, 'server/utils.js');
      expect(findings.length).toBe(1);
    });

    test('new Function() の使用を検出する', () => {
      const lines = ['const fn = new Function("return " + code);'];
      const findings = rule.check(lines, 'server/utils.js');
      expect(findings.length).toBe(1);
    });

    test('コメント内の eval は検出しない', () => {
      const lines = ['// eval() は使わない'];
      const findings = rule.check(lines, 'server/utils.js');
      expect(findings.length).toBe(0);
    });
  });

  describe('SEC003: missing-input-validation', () => {
    const rule = findRule('SEC003');

    test('routes/ 以外のファイルはスキップする', () => {
      const lines = ['const { body } = req.body;'];
      const findings = rule.check(lines, 'server/services/ai.js');
      expect(findings.length).toBe(0);
    });

    test('バリデーションがあるルートは検出しない', () => {
      const lines = [
        'router.post("/create", async (req, res) => {',
        '  try {',
        '    const { theme } = req.body;',
        '    if (!theme) return res.status(400).json({ error: "required" });',
        '    res.json({ ok: true });',
        '  } catch (e) {',
        '    res.status(500).json({ error: e.message });',
        '  }',
        '});',
      ];
      const findings = rule.check(lines, 'server/routes/ai.js');
      expect(findings.length).toBe(0);
    });
  });

  describe('SEC004: sql-injection', () => {
    const rule = findRule('SEC004');

    test('テンプレートリテラル内のSQLインジェクションを検出する', () => {
      const lines = ['db.query(`SELECT * FROM users WHERE id = ${userId}`);'];
      const findings = rule.check(lines, 'server/db.js');
      expect(findings.length).toBe(1);
    });

    test('パラメータ化クエリは検出しない', () => {
      const lines = ['db.query("SELECT * FROM users WHERE id = ?", [userId]);'];
      const findings = rule.check(lines, 'server/db.js');
      expect(findings.length).toBe(0);
    });
  });

  describe('SEC005: command-injection', () => {
    const rule = findRule('SEC005');

    test('テンプレートリテラルを使ったexecを検出する', () => {
      const lines = ['execSync(`git log --author=${userName}`);'];
      const findings = rule.check(lines, 'server/utils.js');
      expect(findings.length).toBe(1);
    });

    test('文字列連結を使ったexecを検出する', () => {
      const lines = ['exec("ls " + userPath, callback);'];
      const findings = rule.check(lines, 'server/utils.js');
      expect(findings.length).toBe(1);
    });

    test('固定文字列のexecは検出しない', () => {
      const lines = ["execSync('git status');"];
      const findings = rule.check(lines, 'server/utils.js');
      expect(findings.length).toBe(0);
    });
  });

  describe('SEC006: cors-wildcard', () => {
    const rule = findRule('SEC006');

    test('cors() をオプションなしで使用する場合を検出する', () => {
      const lines = ['app.use(cors())'];
      const findings = rule.check(lines, 'server/index.js');
      expect(findings.length).toBe(1);
    });

    test('origin: "*" を検出する', () => {
      const lines = ["app.use(cors({ origin: '*' }))"];
      const findings = rule.check(lines, 'server/index.js');
      expect(findings.length).toBe(1);
    });
  });

  describe('SEC007: sensitive-data-logging', () => {
    const rule = findRule('SEC007');

    test('APIキーのログ出力を検出する', () => {
      const lines = ['console.log("api_key:", config.api_key);'];
      const findings = rule.check(lines, 'server/config.js');
      expect(findings.length).toBe(1);
    });

    test('存在チェックのみのログは検出しない', () => {
      const lines = ['console.log(!process.env.API_KEY);'];
      const findings = rule.check(lines, 'server/config.js');
      expect(findings.length).toBe(0);
    });
  });

  describe('SEC008: error-info-leak', () => {
    const rule = findRule('SEC008');

    test('error.stack をレスポンスに含める場合を検出する', () => {
      const lines = ['res.json({ error: error.message, stack: error.stack });'];
      const findings = rule.check(lines, 'server/routes/api.js');
      expect(findings.length).toBe(1);
    });

    test('error.message のみのレスポンスは検出しない', () => {
      const lines = ['res.json({ error: error.message });'];
      const findings = rule.check(lines, 'server/routes/api.js');
      expect(findings.length).toBe(0);
    });
  });
});
