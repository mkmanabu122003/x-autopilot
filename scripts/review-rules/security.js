/**
 * セキュリティレビュールール
 * コード内のセキュリティ上の問題を検出する
 */

const securityRules = [
  {
    id: 'SEC001',
    name: 'hardcoded-secret',
    severity: 'error',
    description: 'APIキーやシークレットがハードコードされている可能性があります',
    check(lines) {
      const findings = [];
      const patterns = [
        /(?:api[_-]?key|secret|password|token|credential)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{16,}['"]/i,
        /sk-[A-Za-z0-9]{20,}/,
        /AIza[A-Za-z0-9_-]{35}/,
      ];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // テストファイルやコメント行はスキップ
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        for (const pattern of patterns) {
          if (pattern.test(line)) {
            // process.env 経由のアクセスは除外
            if (/process\.env\b/.test(line)) continue;
            // .env.example のサンプル値は除外
            if (/your[_-].*here|xxx|placeholder/i.test(line)) continue;
            findings.push({
              line: i + 1,
              message: this.description,
            });
            break;
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'SEC002',
    name: 'eval-usage',
    severity: 'error',
    description: 'eval() または Function() コンストラクタが使用されています。コードインジェクションのリスクがあります',
    check(lines) {
      const findings = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        if (/\beval\s*\(/.test(line) || /new\s+Function\s*\(/.test(line)) {
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
    id: 'SEC003',
    name: 'missing-input-validation',
    severity: 'warning',
    description: 'ルートハンドラでリクエストボディのバリデーションが不足している可能性があります',
    check(lines, filename) {
      if (!filename.includes('routes/')) return [];
      const findings = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // req.body の分割代入を検出し、バリデーションの有無を確認
        if (/req\.body/.test(line) && /(?:router|app)\.\s*(?:post|put|patch)/i.test(lines.slice(Math.max(0, i - 10), i).join('\n'))) {
          // 後続20行以内にバリデーションがあるか確認
          const nextLines = lines.slice(i, Math.min(lines.length, i + 20)).join('\n');
          const hasValidation = /(?:if\s*\(\s*!|\.status\(4[02]\d?\)|joi|zod|validate|sanitize)/i.test(nextLines);
          if (!hasValidation) {
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
    id: 'SEC004',
    name: 'sql-injection',
    severity: 'error',
    description: 'SQLインジェクションのリスクがあります。テンプレートリテラル内でユーザー入力を直接使用しないでください',
    check(lines) {
      const findings = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        // テンプレートリテラル内のSQLクエリにおける変数展開を検出
        if (/(?:query|sql|execute|raw)\s*\(\s*`[^`]*\$\{/.test(line)) {
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
    id: 'SEC005',
    name: 'command-injection',
    severity: 'error',
    description: 'コマンドインジェクションのリスクがあります。child_process にユーザー入力を渡さないでください',
    check(lines) {
      const findings = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        if (/(?:exec|execSync|spawn|spawnSync)\s*\(\s*`/.test(line) ||
            /(?:exec|execSync)\s*\([^)]*\+/.test(line)) {
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
    id: 'SEC006',
    name: 'cors-wildcard',
    severity: 'warning',
    description: 'CORSが全オリジンを許可しています。本番環境では特定のオリジンのみ許可してください',
    check(lines) {
      const findings = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/cors\s*\(\s*\)/.test(line) || /origin\s*:\s*['"]?\*['"]?/.test(line) || /origin\s*:\s*true/.test(line)) {
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
    id: 'SEC007',
    name: 'sensitive-data-logging',
    severity: 'warning',
    description: 'APIキーやトークンなどの機密情報がログに出力される可能性があります',
    check(lines) {
      const findings = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/console\.\w+\s*\(.*(?:api[_-]?key|secret|token|password|credential)/i.test(line)) {
          // process.env のチェック用ログは除外（値を出力していない場合）
          if (/!process\.env|process\.env\.\w+\s*\)/.test(line)) continue;
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
    id: 'SEC008',
    name: 'error-info-leak',
    severity: 'warning',
    description: 'エラーの詳細情報がレスポンスに含まれています。本番環境ではスタックトレースを隠してください',
    check(lines) {
      const findings = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/res\.\w*json\s*\(\s*\{[^}]*(?:stack|stackTrace)/i.test(line) ||
            /res\.(?:send|json)\s*\(.*error\.stack/i.test(line)) {
          findings.push({
            line: i + 1,
            message: this.description,
          });
        }
      }
      return findings;
    },
  },
];

module.exports = securityRules;
