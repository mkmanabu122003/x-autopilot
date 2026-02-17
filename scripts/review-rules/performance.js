/**
 * パフォーマンスレビュールール
 * コード内のパフォーマンス上の問題を検出する
 */

const performanceRules = [
  {
    id: 'PERF001',
    name: 'unbounded-query',
    severity: 'warning',
    description: 'データベースクエリに LIMIT がありません。大量データ取得によるパフォーマンス低下の可能性があります',
    check(lines, filename) {
      if (!filename.match(/\.(js|ts)$/)) return [];
      const findings = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        // Supabase: .select() を呼んでいるが .limit() / .single() / .eq('id' がない場合
        if (/\.from\s*\(/.test(line) && /\.select\s*\(/.test(line)) {
          const context = lines.slice(i, Math.min(lines.length, i + 5)).join('\n');
          if (!/\.limit\s*\(/.test(context) &&
              !/\.single\s*\(/.test(context) &&
              !/\.eq\s*\(\s*['"]id['"]/.test(context) &&
              !/\.maybeSingle\s*\(/.test(context)) {
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
    id: 'PERF002',
    name: 'n-plus-one-query',
    severity: 'warning',
    description: 'ループ内でデータベースクエリが実行されています（N+1問題）。バッチクエリに置き換えてください',
    check(lines) {
      const findings = [];
      let inLoop = false;
      let loopDepth = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // ループの開始を検出
        if (/\b(?:for|while)\s*\(/.test(line) || /\.(?:forEach|map|reduce|filter)\s*\(/.test(line)) {
          inLoop = true;
          loopDepth++;
        }
        // ブレースカウント（簡易）
        const opens = (line.match(/\{/g) || []).length;
        const closes = (line.match(/\}/g) || []).length;
        if (inLoop && closes > opens) {
          loopDepth--;
          if (loopDepth <= 0) {
            inLoop = false;
            loopDepth = 0;
          }
        }
        if (inLoop && /(?:await\s+)?(?:sb|supabase|db|getDb)\s*(?:\(\))?\s*\.from\s*\(/.test(line)) {
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
    id: 'PERF003',
    name: 'missing-async-error-handling',
    severity: 'warning',
    description: 'async関数内でawaitにtry-catchがありません。未処理のPromiseリジェクションが発生する可能性があります',
    check(lines, filename) {
      if (!filename.includes('routes/')) return [];
      const findings = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // async route handler を検出
        if (/(?:router|app)\.\s*(?:get|post|put|patch|delete)\s*\(.*async/.test(line)) {
          // 後続のコードブロックで try-catch があるか確認
          const block = lines.slice(i, Math.min(lines.length, i + 50)).join('\n');
          if (!/try\s*\{/.test(block)) {
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
    id: 'PERF004',
    name: 'sequential-await',
    severity: 'warning',
    description: '独立した複数のawaitが直列実行されています。Promise.all() で並列化を検討してください',
    check(lines) {
      const findings = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*(?:const|let|var)\s+\S+\s*=\s*await\b/.test(line)) {
          // 次の行も独立したawaitか確認
          if (i + 1 < lines.length && /^\s*(?:const|let|var)\s+\S+\s*=\s*await\b/.test(lines[i + 1])) {
            // 2行目が1行目の変数を参照していなければ並列化可能
            const firstVar = line.match(/(?:const|let|var)\s+(\S+)\s*=/)?.[1];
            if (firstVar && !lines[i + 1].includes(firstVar)) {
              findings.push({
                line: i + 1,
                message: this.description,
              });
            }
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'PERF005',
    name: 'large-json-response',
    severity: 'warning',
    description: 'レスポンスにページネーションがありません。大量データの場合、パフォーマンスが低下します',
    check(lines, filename) {
      if (!filename.includes('routes/')) return [];
      const findings = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // select('*') を使ってリスト系のデータを全件返していないかチェック
        if (/\.select\s*\(\s*['"][*]['"]/.test(line) || /\.select\s*\(\s*['"][\w\s,*]+['"]\s*\)/.test(line)) {
          const context = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 10)).join('\n');
          // ページネーション関連のパラメータがあるか確認
          if (!/(?:\.limit|\.range|page|offset|cursor|pagination)/i.test(context) &&
              !/\.single\s*\(/.test(context) &&
              !/\.maybeSingle\s*\(/.test(context) &&
              !/\.eq\s*\(\s*['"]id['"]/.test(context)) {
            // リスト表示系のエンドポイントのみ（GET handler）
            const routeContext = lines.slice(Math.max(0, i - 20), i).join('\n');
            if (/router\.get\s*\(/.test(routeContext)) {
              findings.push({
                line: i + 1,
                message: this.description,
              });
            }
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'PERF006',
    name: 'sync-file-operation',
    severity: 'warning',
    description: '同期的なファイル操作が使用されています。非同期版 (fs.promises) を使用してください',
    check(lines) {
      const findings = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        if (/\b(?:readFileSync|writeFileSync|appendFileSync|existsSync|mkdirSync|readdirSync)\b/.test(line)) {
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

module.exports = performanceRules;
