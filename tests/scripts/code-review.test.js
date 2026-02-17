const { reviewFile, parseArgs, formatText, formatMarkdown, formatGitHubActions } = require('../../scripts/code-review');

describe('code-review', () => {
  describe('parseArgs', () => {
    test('デフォルト引数', () => {
      const args = parseArgs(['node', 'script']);
      expect(args.base).toBeNull();
      expect(args.files).toBeNull();
      expect(args.format).toBe('text');
      expect(args.githubActions).toBe(false);
    });

    test('--base オプション', () => {
      const args = parseArgs(['node', 'script', '--base=main']);
      expect(args.base).toBe('main');
    });

    test('--files オプション', () => {
      const args = parseArgs(['node', 'script', '--files=a.js,b.js']);
      expect(args.files).toEqual(['a.js', 'b.js']);
    });

    test('--format オプション', () => {
      const args = parseArgs(['node', 'script', '--format=json']);
      expect(args.format).toBe('json');
    });

    test('--github-actions フラグ', () => {
      const args = parseArgs(['node', 'script', '--github-actions']);
      expect(args.githubActions).toBe(true);
    });

    test('複合オプション', () => {
      const args = parseArgs(['node', 'script', '--base=develop', '--format=markdown', '--github-actions']);
      expect(args.base).toBe('develop');
      expect(args.format).toBe('markdown');
      expect(args.githubActions).toBe(true);
    });
  });

  describe('reviewFile', () => {
    test('問題のないコードは検出なし', () => {
      const lines = [
        'const express = require("express");',
        'const router = express.Router();',
        'module.exports = router;',
      ];
      const findings = reviewFile('server/utils/helper.js', lines);
      expect(findings.length).toBe(0);
    });

    test('セキュリティ問題を検出する', () => {
      const lines = [
        'const result = eval(userInput);',
      ];
      const findings = reviewFile('server/utils/dangerous.js', lines);
      const evalFinding = findings.find(f => f.ruleId === 'SEC002');
      expect(evalFinding).toBeDefined();
      expect(evalFinding.category).toBe('security');
      expect(evalFinding.severity).toBe('error');
    });

    test('パフォーマンス問題を検出する', () => {
      const lines = [
        "const data = fs.readFileSync('config.json', 'utf-8');",
      ];
      const findings = reviewFile('server/config/loader.js', lines);
      const syncFinding = findings.find(f => f.ruleId === 'PERF006');
      expect(syncFinding).toBeDefined();
      expect(syncFinding.category).toBe('performance');
    });

    test('コスト問題を検出する', () => {
      const lines = [
        'const body = { max_tokens: 16000 };',
      ];
      const findings = reviewFile('server/services/ai.js', lines);
      const costFinding = findings.find(f => f.ruleId === 'COST004');
      expect(costFinding).toBeDefined();
      expect(costFinding.category).toBe('cost');
    });

    test('複数カテゴリの問題を同時に検出する', () => {
      const lines = [
        'const result = eval(code);',
        "const data = fs.readFileSync('data.json');",
        'const body = { max_tokens: 10000 };',
      ];
      const findings = reviewFile('server/services/mixed.js', lines);
      const categories = [...new Set(findings.map(f => f.category))];
      expect(categories).toContain('security');
      expect(categories).toContain('performance');
      expect(categories).toContain('cost');
    });
  });

  describe('formatText', () => {
    test('問題なしの場合', () => {
      const output = formatText([]);
      expect(output).toContain('問題は見つかりませんでした');
    });

    test('問題ありの場合はカテゴリ別に表示する', () => {
      const findings = [
        { ruleId: 'SEC001', ruleName: 'test', category: 'security', severity: 'error', file: 'a.js', line: 1, message: 'セキュリティ問題' },
        { ruleId: 'PERF001', ruleName: 'test', category: 'performance', severity: 'warning', file: 'b.js', line: 2, message: 'パフォーマンス問題' },
      ];
      const output = formatText(findings);
      expect(output).toContain('セキュリティ');
      expect(output).toContain('パフォーマンス');
      expect(output).toContain('合計: 2件');
      expect(output).toContain('エラー: 1');
      expect(output).toContain('警告: 1');
    });

    test('エラーがある場合は修正必要メッセージを表示する', () => {
      const findings = [
        { ruleId: 'SEC001', ruleName: 'test', category: 'security', severity: 'error', file: 'a.js', line: 1, message: 'エラー' },
      ];
      const output = formatText(findings);
      expect(output).toContain('修正が必要');
    });
  });

  describe('formatMarkdown', () => {
    test('問題なしの場合', () => {
      const output = formatMarkdown([]);
      expect(output).toContain('問題は見つかりませんでした');
    });

    test('問題ありの場合はテーブルで表示する', () => {
      const findings = [
        { ruleId: 'SEC001', ruleName: 'test', category: 'security', severity: 'error', file: 'a.js', line: 1, message: 'テスト' },
        { ruleId: 'COST001', ruleName: 'test', category: 'cost', severity: 'warning', file: 'b.js', line: 2, message: 'コスト' },
      ];
      const output = formatMarkdown(findings);
      expect(output).toContain('自動コードレビュー結果');
      expect(output).toContain('| カテゴリ');
      expect(output).toContain('セキュリティ');
      expect(output).toContain('コスト最適化');
    });

    test('エラーがある場合はマージ警告を表示する', () => {
      const findings = [
        { ruleId: 'SEC001', ruleName: 'test', category: 'security', severity: 'error', file: 'a.js', line: 1, message: 'エラー' },
      ];
      const output = formatMarkdown(findings);
      expect(output).toContain('マージ前に修正');
    });
  });

  describe('formatGitHubActions', () => {
    test('エラーは ::error:: で出力する', () => {
      const findings = [
        { ruleId: 'SEC001', ruleName: 'hardcoded-secret', category: 'security', severity: 'error', file: 'a.js', line: 5, message: 'テスト' },
      ];
      const output = formatGitHubActions(findings);
      expect(output).toContain('::error file=a.js,line=5');
    });

    test('警告は ::warning:: で出力する', () => {
      const findings = [
        { ruleId: 'PERF001', ruleName: 'test', category: 'performance', severity: 'warning', file: 'b.js', line: 10, message: 'テスト' },
      ];
      const output = formatGitHubActions(findings);
      expect(output).toContain('::warning file=b.js,line=10');
    });

    test('情報は ::notice:: で出力する', () => {
      const findings = [
        { ruleId: 'COST005', ruleName: 'test', category: 'cost', severity: 'info', file: 'c.js', line: 3, message: 'テスト' },
      ];
      const output = formatGitHubActions(findings);
      expect(output).toContain('::notice file=c.js,line=3');
    });
  });
});
