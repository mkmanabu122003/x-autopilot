const prompts = require('../../server/config/prompts');

describe('prompts', () => {
  const expectedTaskTypes = [
    'tweet_generation',
    'comment_generation',
    'reply_generation',
    'quote_rt_generation',
    'competitor_analysis',
    'performance_summary'
  ];

  test.each(expectedTaskTypes)('%s のプロンプトが定義されている', (taskType) => {
    expect(prompts).toHaveProperty(taskType);
  });

  test.each(expectedTaskTypes)('%s に system プロンプトがある', (taskType) => {
    expect(prompts[taskType]).toHaveProperty('system');
    expect(typeof prompts[taskType].system).toBe('string');
    expect(prompts[taskType].system.length).toBeGreaterThan(0);
  });

  test.each(expectedTaskTypes)('%s に userTemplate がある', (taskType) => {
    expect(prompts[taskType]).toHaveProperty('userTemplate');
    expect(typeof prompts[taskType].userTemplate).toBe('string');
  });

  test('reply_generation にAnti-AI-Smellルールが含まれる', () => {
    expect(prompts.reply_generation.system).toContain('Anti-AI-Smell');
  });

  test('quote_rt_generation にAnti-AI-Smellルールが含まれる', () => {
    expect(prompts.quote_rt_generation.system).toContain('Anti-AI-Smell');
  });

  test('reply_generation に禁止表現が定義されている', () => {
    const system = prompts.reply_generation.system;
    expect(system).toContain('禁止表現');
    expect(system).toContain('素晴らしい');
    expect(system).toContain('なるほど');
  });

  test('reply_generation にJSON出力形式が指定されている', () => {
    expect(prompts.reply_generation.system).toContain('variants');
    expect(prompts.reply_generation.system).toContain('JSON');
  });

  test('quote_rt_generation にJSON出力形式が指定されている', () => {
    expect(prompts.quote_rt_generation.system).toContain('variants');
    expect(prompts.quote_rt_generation.system).toContain('JSON');
  });

  test('tweet_generation に日本語280文字制限が含まれる', () => {
    expect(prompts.tweet_generation.system).toContain('280文字');
  });

  test('tweet_generation にAnti-AI-Smellルールが含まれる', () => {
    expect(prompts.tweet_generation.system).toContain('Anti-AI-Smell');
  });

  test('tweet_generation に禁止表現が定義されている', () => {
    const system = prompts.tweet_generation.system;
    expect(system).toContain('禁止表現');
    expect(system).toContain('素晴らしい');
    expect(system).toContain('なるほど');
  });

  test('tweet_generation にJSON出力形式が指定されている', () => {
    expect(prompts.tweet_generation.system).toContain('variants');
    expect(prompts.tweet_generation.system).toContain('JSON');
  });

  test('tweet_generation にとっけんのペルソナ情報が含まれる', () => {
    const system = prompts.tweet_generation.system;
    expect(system).toContain('通訳案内士');
    expect(system).toContain('とっけん');
  });

  test('comment_generation に140文字制限が含まれる', () => {
    expect(prompts.comment_generation.system).toContain('140文字');
  });

  test.each(['tweet_generation', 'reply_generation', 'quote_rt_generation'])(
    '%s にbodyフィールドの厳格ルールが含まれる',
    (taskType) => {
      const system = prompts[taskType].system;
      expect(system).toContain('bodyフィールドの厳格ルール');
      expect(system).toContain('そのままXに投稿できる完成テキストのみ');
      expect(system).toContain('パターン名やラベル');
    }
  );

  test.each(['tweet_generation', 'reply_generation', 'quote_rt_generation'])(
    '%s にハッシュタグ禁止が含まれる',
    (taskType) => {
      const system = prompts[taskType].system;
      expect(system).toContain('ハッシュタグは入れない');
    }
  );

  test.each(['tweet_generation', 'reply_generation', 'quote_rt_generation'])(
    '%s でツアー回数が500回以上になっている',
    (taskType) => {
      const system = prompts[taskType].system;
      expect(system).toContain('500回以上');
      expect(system).not.toContain('516回');
    }
  );

  test.each(['tweet_generation', 'reply_generation', 'quote_rt_generation'])(
    '%s にツアー回数の多用防止ルールが含まれる',
    (taskType) => {
      const system = prompts[taskType].system;
      expect(system).toContain('5回に1回程度');
    }
  );

  test.each(['tweet_generation', 'reply_generation', 'quote_rt_generation'])(
    '%s にパターンのランダム選択指示が含まれる',
    (taskType) => {
      const system = prompts[taskType].system;
      expect(system).toContain('ランダム');
    }
  );

  test('tweet_generation にコードフェンス禁止指示が含まれる', () => {
    expect(prompts.tweet_generation.system).toContain('コードフェンス');
  });

  test('tweet_generation に8つ以上のパターンが定義されている', () => {
    const system = prompts.tweet_generation.system;
    expect(system).toContain('パターンA');
    expect(system).toContain('パターンH');
  });
});
