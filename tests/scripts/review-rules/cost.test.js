const costRules = require('../../../scripts/review-rules/cost');

function findRule(id) {
  return costRules.find(r => r.id === id);
}

describe('コスト最適化レビュールール', () => {
  describe('COST001: expensive-model-for-simple-task', () => {
    const rule = findRule('COST001');

    test('軽量タスクに Opus モデルを使う場合を検出する', () => {
      const lines = [
        'const taskType = "comment_generation";',
        'const model = "claude-opus-4-6";',
        'const result = await generate(model, prompt);',
      ];
      const findings = rule.check(lines, 'server/services/ai.js');
      expect(findings.length).toBe(1);
    });

    test('分析タスクに Opus モデルを使う場合は検出しない', () => {
      const lines = [
        'const model = "claude-opus-4-6";',
        'const analysis = await deepAnalysis(model, data);',
      ];
      const findings = rule.check(lines, 'server/services/ai.js');
      expect(findings.length).toBe(0);
    });
  });

  describe('COST003: missing-budget-check', () => {
    const rule = findRule('COST003');

    test('予算チェックなしのAPI呼び出しを検出する', () => {
      const lines = [
        'async function callApi() {',
        "  const response = await fetch('https://api.anthropic.com/v1/messages', {",
        "    method: 'POST',",
        '    body: JSON.stringify(data),',
        '  });',
        '}',
      ];
      const findings = rule.check(lines, 'server/services/new-provider.js');
      expect(findings.length).toBe(1);
    });

    test('予算チェックがあるAPI呼び出しは検出しない', () => {
      const lines = [
        'async function callApi() {',
        '  const budgetStatus = await checkBudgetStatus();',
        '  if (budgetStatus.shouldPause) throw new Error("budget exceeded");',
        "  const response = await fetch('https://api.anthropic.com/v1/messages', {",
        "    method: 'POST',",
        '  });',
        '}',
      ];
      const findings = rule.check(lines, 'server/services/ai-provider.js');
      expect(findings.length).toBe(0);
    });

    test('routes/services 以外のファイルはスキップする', () => {
      const lines = [
        "fetch('https://api.anthropic.com/v1/messages');",
      ];
      const findings = rule.check(lines, 'client/src/App.jsx');
      expect(findings.length).toBe(0);
    });
  });

  describe('COST004: excessive-max-tokens', () => {
    const rule = findRule('COST004');

    test('4096 を超える max_tokens を検出する', () => {
      const lines = [
        'const body = { max_tokens: 8192 };',
      ];
      const findings = rule.check(lines, 'server/services/ai.js');
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain('8192');
    });

    test('4096 以下の max_tokens は検出しない', () => {
      const lines = [
        'const body = { max_tokens: 2048 };',
      ];
      const findings = rule.check(lines, 'server/services/ai.js');
      expect(findings.length).toBe(0);
    });

    test('コメント行は検出しない', () => {
      const lines = [
        '// max_tokens: 8192',
      ];
      const findings = rule.check(lines, 'server/services/ai.js');
      expect(findings.length).toBe(0);
    });
  });

  describe('COST005: missing-batch-api', () => {
    const rule = findRule('COST005');

    test('スケジューラ内の直接API呼び出しを検出する', () => {
      const lines = [
        'async function scheduledTask() {',
        "  const response = await fetch('https://api.anthropic.com/v1/messages', {",
        "    method: 'POST',",
        '  });',
        '}',
      ];
      const findings = rule.check(lines, 'server/services/scheduler.js');
      expect(findings.length).toBe(1);
    });

    test('batch フラグがあるAPI呼び出しは検出しない', () => {
      const lines = [
        'const isBatch = true;',
        '// use batch API',
        "const response = await fetch('https://api.anthropic.com/v1/messages', {",
        "  method: 'POST',",
        '});',
      ];
      const findings = rule.check(lines, 'server/services/scheduler.js');
      expect(findings.length).toBe(0);
    });

    test('通常のサービスファイルはスキップする', () => {
      const lines = [
        "fetch('https://api.anthropic.com/v1/messages');",
      ];
      const findings = rule.check(lines, 'server/services/ai-provider.js');
      expect(findings.length).toBe(0);
    });
  });

  describe('COST006: missing-cost-logging', () => {
    const rule = findRule('COST006');

    test('コストログなしのAPI呼び出しを検出する', () => {
      const lines = [
        'async function newApiCall() {',
        "  const response = await fetch('https://api.anthropic.com/v1/messages', {",
        "    method: 'POST',",
        '  });',
        '  return response.json();',
        '}',
      ];
      const findings = rule.check(lines, 'server/services/new-provider.js');
      expect(findings.length).toBe(1);
    });

    test('logDetailedUsage がある場合は検出しない', () => {
      const lines = [
        'async function apiCall() {',
        "  const response = await fetch('https://api.anthropic.com/v1/messages', {});",
        '  const data = await response.json();',
        '  await logDetailedUsage({ provider, model, inputTokens, outputTokens });',
        '  return data;',
        '}',
      ];
      const findings = rule.check(lines, 'server/services/ai-provider.js');
      expect(findings.length).toBe(0);
    });
  });

  describe('COST007: model-pricing-not-updated', () => {
    const rule = findRule('COST007');

    test('未登録のモデルIDを検出する', () => {
      const lines = [
        "const model = 'claude-sonnet-5-20260101';",
      ];
      const findings = rule.check(lines, 'server/services/ai-provider.js');
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain('claude-sonnet-5-20260101');
    });

    test('既知のモデルIDは検出しない', () => {
      const lines = [
        "const model = 'claude-sonnet-4-20250514';",
      ];
      const findings = rule.check(lines, 'server/services/ai-provider.js');
      expect(findings.length).toBe(0);
    });

    test('model-pricing.js 自体はスキップする', () => {
      const lines = [
        '"claude-new-model": { inputPerMTok: 1.0 }',
      ];
      const findings = rule.check(lines, 'server/config/model-pricing.js');
      expect(findings.length).toBe(0);
    });

    test('テストファイルはスキップする', () => {
      const lines = [
        "const model = 'claude-unknown-model';",
      ];
      const findings = rule.check(lines, 'tests/services/ai.test.js');
      expect(findings.length).toBe(0);
    });
  });
});
