/**
 * コスト最適化レビュールール
 * API利用料金に関する問題を検出する
 */

const costRules = [
  {
    id: 'COST001',
    name: 'expensive-model-for-simple-task',
    severity: 'warning',
    description: '低コストタスクに高コストモデル (Opus) が使用されています。Haiku や Flash の使用を検討してください',
    check(lines) {
      const findings = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        // Opus モデルが comment/reply/quote_rt のような軽量タスクに使われている場合
        if (/opus/.test(line) && /(?:comment|reply|quote_rt|quote)/.test(lines.slice(Math.max(0, i - 10), i + 10).join('\n'))) {
          findings.push({
            line: i + 1,
            message: this.description,
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'COST002',
    name: 'missing-prompt-caching',
    severity: 'warning',
    description: 'API呼び出しでプロンプトキャッシュが使用されていません。cache_control の設定を検討してください',
    check(lines, filename) {
      if (!filename.match(/(?:services|routes).*\.(js|ts)$/)) return [];
      const findings = [];
      const content = lines.join('\n');

      // Anthropic API 呼び出しがあるがキャッシュ設定がない場合
      if (/api\.anthropic\.com/.test(content) || /claude/i.test(content)) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/system\s*[:=]/.test(line) && !/cache_control/.test(lines.slice(i, Math.min(lines.length, i + 5)).join('\n'))) {
            // cache_enabled チェックがある場合は除外
            const context = lines.slice(Math.max(0, i - 10), Math.min(lines.length, i + 10)).join('\n');
            if (/cache_enabled/.test(context)) continue;
            findings.push({
              line: i + 1,
              message: this.description,
            });
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'COST003',
    name: 'missing-budget-check',
    severity: 'error',
    description: 'API呼び出し前に予算チェックが行われていません。予算超過を防ぐためcheckBudgetStatusを使用してください',
    check(lines, filename) {
      if (!filename.match(/(?:services|routes).*\.(js|ts)$/)) return [];
      const findings = [];
      const content = lines.join('\n');

      // API呼び出しがあるか確認
      const hasApiCall = /api\.anthropic\.com|generativelanguage\.googleapis\.com/.test(content);
      if (!hasApiCall) return [];

      // 予算チェックがあるか確認
      const hasBudgetCheck = /checkBudgetStatus|budgetStatus|budget_pause/.test(content);
      if (!hasBudgetCheck) {
        // ファイル内のfetch呼び出し行を特定
        for (let i = 0; i < lines.length; i++) {
          if (/fetch\s*\(\s*['"`]https:\/\/(?:api\.anthropic|generativelanguage\.googleapis)/.test(lines[i])) {
            findings.push({
              line: i + 1,
              message: this.description,
            });
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'COST004',
    name: 'excessive-max-tokens',
    severity: 'warning',
    description: 'max_tokensの値が大きすぎます。タスクに必要な最小限の値に設定してください',
    check(lines) {
      const findings = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        const match = line.match(/max[_-]?tokens\s*[:=]\s*(\d+)/i);
        if (match) {
          const tokens = parseInt(match[1], 10);
          if (tokens > 4096) {
            findings.push({
              line: i + 1,
              message: `${this.description}（現在値: ${tokens}）`,
            });
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'COST005',
    name: 'missing-batch-api',
    severity: 'info',
    description: '即時性が不要な処理でリアルタイムAPI呼び出しが使用されています。Batch APIの利用で50%のコスト削減が可能です',
    check(lines, filename) {
      if (!filename.match(/(?:scheduler|auto-poster|batch|cron).*\.(js|ts)$/)) return [];
      const findings = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        // スケジューラーやバッチ処理内で直接API呼び出しがある場合
        if (/fetch\s*\(\s*['"`]https:\/\/(?:api\.anthropic|generativelanguage\.googleapis)/.test(line)) {
          const context = lines.slice(Math.max(0, i - 20), i).join('\n');
          if (!/batch|is_batch|isBatch/.test(context)) {
            findings.push({
              line: i + 1,
              message: this.description,
            });
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'COST006',
    name: 'missing-cost-logging',
    severity: 'warning',
    description: 'API呼び出し後にコストログが記録されていません。logDetailedUsageを使用してください',
    check(lines, filename) {
      if (!filename.match(/(?:services|routes).*\.(js|ts)$/)) return [];
      const findings = [];
      const content = lines.join('\n');

      // API呼び出しがあるか確認
      const hasApiCall = /api\.anthropic\.com|generativelanguage\.googleapis\.com/.test(content);
      if (!hasApiCall) return [];

      // コストログがあるか確認
      const hasCostLogging = /logDetailedUsage|logApiUsage|log.*[Uu]sage/.test(content);
      if (!hasCostLogging) {
        for (let i = 0; i < lines.length; i++) {
          if (/fetch\s*\(\s*['"`]https:\/\/(?:api\.anthropic|generativelanguage\.googleapis)/.test(lines[i])) {
            findings.push({
              line: i + 1,
              message: this.description,
            });
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'COST007',
    name: 'model-pricing-not-updated',
    severity: 'warning',
    description: '新しいモデルIDがmodel-pricing.jsに登録されていない可能性があります。コスト計算が正しく行われません',
    check(lines, filename) {
      if (!filename.match(/\.(js|ts)$/)) return [];
      const findings = [];

      // 既知のモデルパターンに一致しない新しいモデルIDを検出
      const knownModels = [
        'claude-opus-4-6', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001',
        'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite',
        'gemini-1.5-pro', 'gemini-1.5-flash',
      ];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        // モデルIDパターンを検出
        const modelMatches = line.matchAll(/['"](?:claude-[a-z0-9-]+|gemini-[a-z0-9.-]+)['"]/g);
        for (const match of modelMatches) {
          const modelId = match[0].replace(/['"]/g, '');
          if (!knownModels.includes(modelId) && /(?:claude|gemini)-/.test(modelId)) {
            // model-pricing.js 自体は除外
            if (filename.includes('model-pricing')) continue;
            // テストファイルは除外
            if (filename.includes('test')) continue;
            findings.push({
              line: i + 1,
              message: `${this.description}（モデル: ${modelId}）`,
            });
          }
        }
      }
      return findings;
    },
  },
];

module.exports = costRules;
