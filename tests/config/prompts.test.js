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

  test('reply_generation に絶対禁止事項が定義されている', () => {
    const system = prompts.reply_generation.system;
    expect(system).toContain('絶対禁止事項');
    expect(system).toContain('プラットフォーム名');
    expect(system).toContain('個人情報');
  });

  test('reply_generation にJSON出力形式が指定されている', () => {
    expect(prompts.reply_generation.system).toContain('variants');
    expect(prompts.reply_generation.system).toContain('JSON');
  });

  test('quote_rt_generation にJSON出力形式が指定されている', () => {
    expect(prompts.quote_rt_generation.system).toContain('variants');
    expect(prompts.quote_rt_generation.system).toContain('JSON');
  });

  test('tweet_generation にAnti-AI-Smellルールが含まれる', () => {
    expect(prompts.tweet_generation.system).toContain('Anti-AI-Smell');
  });

  test('tweet_generation に絶対禁止事項が定義されている', () => {
    const system = prompts.tweet_generation.system;
    expect(system).toContain('絶対禁止事項');
    expect(system).toContain('プラットフォーム名');
    expect(system).toContain('個人情報');
  });

  test('tweet_generation にJSON出力形式が指定されている', () => {
    expect(prompts.tweet_generation.system).toContain('variants');
    expect(prompts.tweet_generation.system).toContain('JSON');
  });

  test('tweet_generation に河原学のペルソナ情報が含まれる', () => {
    const system = prompts.tweet_generation.system;
    expect(system).toContain('通訳案内士');
    expect(system).toContain('河原学');
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

  test.each(['tweet_generation', 'reply_generation', 'quote_rt_generation'])(
    '%s にAnti-AI-Smell P1〜P6ルールが含まれる',
    (taskType) => {
      const system = prompts[taskType].system;
      expect(system).toContain('記号残骸回避');
      expect(system).toContain('リズム単調回避');
      expect(system).toContain('保険表現回避');
    }
  );

  test.each(['tweet_generation', 'reply_generation', 'quote_rt_generation'])(
    '%s にプラットフォーム名禁止が含まれる',
    (taskType) => {
      const system = prompts[taskType].system;
      expect(system).toContain('GuruWalk');
      expect(system).toContain('絶対に出さない');
    }
  );

  test.each(['tweet_generation', 'quote_rt_generation'])(
    '%s に体験→観察→結論の3パート構成が含まれる',
    (taskType) => {
      const system = prompts[taskType].system;
      expect(system).toContain('3パート構成');
    }
  );

  test.each(['tweet_generation', 'reply_generation', 'quote_rt_generation'])(
    '%s に河原学のペルソナが含まれる',
    (taskType) => {
      const system = prompts[taskType].system;
      expect(system).toContain('河原学');
      expect(system).toContain('通訳案内士');
    }
  );
});
