const modelPricing = require('../../server/config/model-pricing');

describe('model-pricing', () => {
  test('claude プロバイダーが存在する', () => {
    expect(modelPricing).toHaveProperty('claude');
  });

  test('gemini プロバイダーが存在する', () => {
    expect(modelPricing).toHaveProperty('gemini');
  });

  describe('Claude モデルの料金設定', () => {
    const claudeModels = [
      'claude-opus-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-20250514',
      'claude-haiku-4-5-20251001'
    ];

    test.each(claudeModels)('%s が定義されている', (modelId) => {
      expect(modelPricing.claude).toHaveProperty(modelId);
    });

    test.each(claudeModels)('%s に必須フィールドがある', (modelId) => {
      const pricing = modelPricing.claude[modelId];
      expect(pricing).toHaveProperty('inputPerMTok');
      expect(pricing).toHaveProperty('outputPerMTok');
      expect(pricing).toHaveProperty('cacheWritePerMTok');
      expect(pricing).toHaveProperty('cacheReadPerMTok');
      expect(pricing).toHaveProperty('label');
    });

    test.each(claudeModels)('%s の価格が正の数', (modelId) => {
      const pricing = modelPricing.claude[modelId];
      expect(pricing.inputPerMTok).toBeGreaterThan(0);
      expect(pricing.outputPerMTok).toBeGreaterThan(0);
      expect(pricing.cacheWritePerMTok).toBeGreaterThan(0);
      expect(pricing.cacheReadPerMTok).toBeGreaterThan(0);
    });

    test('output は input より高い', () => {
      for (const modelId of claudeModels) {
        const pricing = modelPricing.claude[modelId];
        expect(pricing.outputPerMTok).toBeGreaterThan(pricing.inputPerMTok);
      }
    });

    test('キャッシュ読取は通常入力より安い', () => {
      for (const modelId of claudeModels) {
        const pricing = modelPricing.claude[modelId];
        expect(pricing.cacheReadPerMTok).toBeLessThan(pricing.inputPerMTok);
      }
    });

    test('Opus が最も高価', () => {
      const opus = modelPricing.claude['claude-opus-4-6'];
      const sonnet = modelPricing.claude['claude-sonnet-4-20250514'];
      const haiku = modelPricing.claude['claude-haiku-4-5-20251001'];
      expect(opus.inputPerMTok).toBeGreaterThan(sonnet.inputPerMTok);
      expect(opus.outputPerMTok).toBeGreaterThan(sonnet.outputPerMTok);
      expect(sonnet.inputPerMTok).toBeGreaterThan(haiku.inputPerMTok);
    });
  });

  describe('Gemini モデルの料金設定', () => {
    const geminiModels = [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-1.5-pro',
      'gemini-1.5-flash'
    ];

    test.each(geminiModels)('%s が定義されている', (modelId) => {
      expect(modelPricing.gemini[modelId]).toBeDefined();
    });

    test.each(geminiModels)('%s に必須フィールドがある', (modelId) => {
      const pricing = modelPricing.gemini[modelId];
      expect(pricing).toHaveProperty('inputPerMTok');
      expect(pricing).toHaveProperty('outputPerMTok');
      expect(pricing).toHaveProperty('label');
    });

    test.each(geminiModels)('%s の価格が正の数', (modelId) => {
      const pricing = modelPricing.gemini[modelId];
      expect(pricing.inputPerMTok).toBeGreaterThan(0);
      expect(pricing.outputPerMTok).toBeGreaterThan(0);
    });

    test('Gemini 2.0 Flash Lite が最安', () => {
      const flashLite = modelPricing.gemini['gemini-2.0-flash-lite'];
      const flash = modelPricing.gemini['gemini-2.0-flash'];
      expect(flashLite.inputPerMTok).toBeLessThanOrEqual(flash.inputPerMTok);
    });
  });
});
