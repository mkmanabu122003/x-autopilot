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

  test('comment_generation に140文字制限が含まれる', () => {
    expect(prompts.comment_generation.system).toContain('140文字');
  });
});
