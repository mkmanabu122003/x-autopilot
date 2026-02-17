#!/usr/bin/env node

/**
 * 自動コードレビュースクリプト
 *
 * git diff から変更ファイルを取得し、以下の観点でレビューを実行する:
 * - セキュリティ: APIキー露出、インジェクション、バリデーション不足など
 * - パフォーマンス: N+1クエリ、無制限データ取得、同期処理など
 * - コスト最適化: 高コストモデル使用、キャッシュ未使用、予算チェック漏れなど
 *
 * 使い方:
 *   node scripts/code-review.js                    # ステージング済みの変更をレビュー
 *   node scripts/code-review.js --base=main        # main ブランチとの差分をレビュー
 *   node scripts/code-review.js --files=a.js,b.js  # 指定ファイルをレビュー
 *   node scripts/code-review.js --format=json      # JSON形式で出力
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { allRules } = require('./review-rules');

const SEVERITY_ICONS = {
  error: '\u274c',
  warning: '\u26a0\ufe0f',
  info: '\u2139\ufe0f',
};

const CATEGORY_LABELS = {
  security: '\u{1f512} セキュリティ',
  performance: '\u26a1 パフォーマンス',
  cost: '\u{1f4b0} コスト最適化',
};

/**
 * コマンドライン引数をパースする
 */
function parseArgs(argv) {
  const args = {
    base: null,
    files: null,
    format: 'text',
    githubActions: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--base=')) {
      args.base = arg.slice('--base='.length);
    } else if (arg.startsWith('--files=')) {
      args.files = arg.slice('--files='.length).split(',').map(f => f.trim());
    } else if (arg.startsWith('--format=')) {
      args.format = arg.slice('--format='.length);
    } else if (arg === '--github-actions') {
      args.githubActions = true;
    }
  }

  return args;
}

/**
 * git diff から変更されたファイル一覧を取得する
 */
function getChangedFiles(base) {
  try {
    let cmd;
    if (base) {
      cmd = `git diff --name-only --diff-filter=ACMR ${base}...HEAD`;
    } else {
      // ステージング済み + 未ステージング
      cmd = 'git diff --name-only --diff-filter=ACMR HEAD';
    }
    const output = execSync(cmd, { encoding: 'utf-8' }).trim();
    if (!output) return [];
    return output.split('\n').filter(f => f.match(/\.(js|ts|jsx|tsx)$/));
  } catch {
    // HEAD が存在しない場合（初回コミット前など）
    try {
      const output = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf-8' }).trim();
      if (!output) return [];
      return output.split('\n').filter(f => f.match(/\.(js|ts|jsx|tsx)$/));
    } catch {
      return [];
    }
  }
}

/**
 * ファイルを読み込んで行の配列で返す
 */
function readFileLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n');
  } catch {
    return null;
  }
}

/**
 * 単一ファイルに対してすべてのルールを実行する
 */
function reviewFile(filePath, lines) {
  const findings = [];

  for (const rule of allRules) {
    const ruleFindings = rule.check(lines, filePath);
    for (const finding of ruleFindings) {
      findings.push({
        ruleId: rule.id,
        ruleName: rule.name,
        category: rule.category,
        severity: rule.severity,
        file: filePath,
        line: finding.line,
        message: finding.message,
      });
    }
  }

  return findings;
}

/**
 * レビュー結果をテキスト形式でフォーマットする
 */
function formatText(findings) {
  if (findings.length === 0) {
    return '\u2705 コードレビュー完了: 問題は見つかりませんでした\n';
  }

  const lines = [];
  lines.push('='.repeat(60));
  lines.push('\u{1f50d} 自動コードレビュー結果');
  lines.push('='.repeat(60));
  lines.push('');

  // カテゴリ別にグループ化
  const byCategory = {};
  for (const f of findings) {
    if (!byCategory[f.category]) byCategory[f.category] = [];
    byCategory[f.category].push(f);
  }

  for (const [category, items] of Object.entries(byCategory)) {
    lines.push(`${CATEGORY_LABELS[category] || category} (${items.length}件)`);
    lines.push('-'.repeat(40));

    for (const item of items) {
      const icon = SEVERITY_ICONS[item.severity] || '';
      lines.push(`  ${icon} [${item.ruleId}] ${item.file}:${item.line}`);
      lines.push(`     ${item.message}`);
    }
    lines.push('');
  }

  // サマリー
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const infos = findings.filter(f => f.severity === 'info').length;
  lines.push('-'.repeat(40));
  lines.push(`合計: ${findings.length}件 (エラー: ${errors}, 警告: ${warnings}, 情報: ${infos})`);

  if (errors > 0) {
    lines.push('');
    lines.push('\u274c エラーが検出されました。修正が必要です。');
  }

  return lines.join('\n');
}

/**
 * GitHub Actions 用のアノテーション出力
 */
function formatGitHubActions(findings) {
  const lines = [];

  for (const f of findings) {
    const level = f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'notice';
    lines.push(`::${level} file=${f.file},line=${f.line},title=[${f.ruleId}] ${f.ruleName}::${f.message}`);
  }

  return lines.join('\n');
}

/**
 * GitHub Actions PR コメント用 Markdown 出力
 */
function formatMarkdown(findings) {
  if (findings.length === 0) {
    return '## \u2705 自動コードレビュー\n\n問題は見つかりませんでした。';
  }

  const lines = [];
  lines.push('## \u{1f50d} 自動コードレビュー結果\n');

  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const infos = findings.filter(f => f.severity === 'info').length;

  lines.push(`| カテゴリ | エラー | 警告 | 情報 |`);
  lines.push(`|---------|--------|------|------|`);

  const byCategory = {};
  for (const f of findings) {
    if (!byCategory[f.category]) byCategory[f.category] = { error: 0, warning: 0, info: 0 };
    byCategory[f.category][f.severity]++;
  }

  for (const [category, counts] of Object.entries(byCategory)) {
    const label = CATEGORY_LABELS[category] || category;
    lines.push(`| ${label} | ${counts.error} | ${counts.warning} | ${counts.info} |`);
  }

  lines.push('');

  // 詳細
  for (const [category, _] of Object.entries(byCategory)) {
    const items = findings.filter(f => f.category === category);
    lines.push(`### ${CATEGORY_LABELS[category] || category}\n`);

    for (const item of items) {
      const icon = SEVERITY_ICONS[item.severity] || '';
      lines.push(`- ${icon} **[${item.ruleId}]** \`${item.file}:${item.line}\``);
      lines.push(`  ${item.message}`);
    }
    lines.push('');
  }

  if (errors > 0) {
    lines.push(`---\n\u274c **${errors}件のエラー**が検出されました。マージ前に修正してください。`);
  }

  return lines.join('\n');
}

/**
 * メイン処理
 */
function run(argv) {
  const args = parseArgs(argv || process.argv);

  // レビュー対象ファイルの取得
  let files;
  if (args.files) {
    files = args.files;
  } else {
    files = getChangedFiles(args.base);
  }

  if (files.length === 0) {
    const msg = '\u2705 レビュー対象のファイルがありません\n';
    if (args.format === 'json') {
      const result = { findings: [], summary: { total: 0, errors: 0, warnings: 0, infos: 0 }, files: [] };
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write(msg);
    }
    return { findings: [], exitCode: 0 };
  }

  // 各ファイルをレビュー
  const allFindings = [];
  for (const file of files) {
    const lines = readFileLines(file);
    if (!lines) continue;
    const findings = reviewFile(file, lines);
    allFindings.push(...findings);
  }

  // 出力
  if (args.format === 'json') {
    const result = {
      findings: allFindings,
      summary: {
        total: allFindings.length,
        errors: allFindings.filter(f => f.severity === 'error').length,
        warnings: allFindings.filter(f => f.severity === 'warning').length,
        infos: allFindings.filter(f => f.severity === 'info').length,
      },
      files: files,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (args.format === 'markdown') {
    process.stdout.write(formatMarkdown(allFindings) + '\n');
  } else {
    process.stdout.write(formatText(allFindings) + '\n');
  }

  // GitHub Actions アノテーション出力
  if (args.githubActions) {
    const annotations = formatGitHubActions(allFindings);
    if (annotations) {
      process.stdout.write(annotations + '\n');
    }
  }

  const hasErrors = allFindings.some(f => f.severity === 'error');
  return { findings: allFindings, exitCode: hasErrors ? 1 : 0 };
}

// CLI実行
if (require.main === module) {
  const result = run();
  process.exit(result.exitCode);
}

module.exports = { run, reviewFile, parseArgs, getChangedFiles, formatText, formatMarkdown, formatGitHubActions };
