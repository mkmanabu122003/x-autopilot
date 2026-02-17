describe('crypto', () => {
  const originalEnv = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests';
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
    // Clear require cache to re-load with fresh env
    jest.resetModules();
  });

  function loadCrypto() {
    return require('../../server/utils/crypto');
  }

  test('暗号化と復号化の往復テスト', () => {
    const { encrypt, decrypt } = loadCrypto();
    const plaintext = 'my-secret-api-key-12345';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  test('暗号化結果は元のテキストと異なる', () => {
    const { encrypt } = loadCrypto();
    const plaintext = 'secret-value';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
  });

  test('同じ入力でも毎回異なる暗号文を生成 (IV がランダム)', () => {
    const { encrypt } = loadCrypto();
    const plaintext = 'same-input';
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);
    expect(encrypted1).not.toBe(encrypted2);
  });

  test('異なる暗号文でも同じ平文に復号できる', () => {
    const { encrypt, decrypt } = loadCrypto();
    const plaintext = 'same-input';
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);
    expect(decrypt(encrypted1)).toBe(plaintext);
    expect(decrypt(encrypted2)).toBe(plaintext);
  });

  test('日本語テキストの暗号化・復号化', () => {
    const { encrypt, decrypt } = loadCrypto();
    const plaintext = 'これはテスト用のAPIキーです';
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  test('空文字列は空文字列を返す', () => {
    const { encrypt, decrypt } = loadCrypto();
    expect(encrypt('')).toBe('');
    expect(decrypt('')).toBe('');
  });

  test('null/undefined 入力は空文字列を返す', () => {
    const { encrypt, decrypt } = loadCrypto();
    expect(encrypt(null)).toBe('');
    expect(encrypt(undefined)).toBe('');
    expect(decrypt(null)).toBe('');
    expect(decrypt(undefined)).toBe('');
  });

  test('長いテキストも正しく暗号化・復号化', () => {
    const { encrypt, decrypt } = loadCrypto();
    const plaintext = 'a'.repeat(10000);
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  test('暗号化結果は base64 フォーマット', () => {
    const { encrypt } = loadCrypto();
    const encrypted = encrypt('test-data');
    // base64の文字セットのみで構成されている
    expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  test('ENCRYPTION_KEY がない場合はエラーを投げる', () => {
    delete process.env.ENCRYPTION_KEY;
    const { encrypt } = loadCrypto();
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY environment variable is not set');
  });

  test('不正な暗号文で復号するとエラーを投げる', () => {
    const { decrypt } = loadCrypto();
    expect(() => decrypt('invalid-base64-data!!!')).toThrow();
  });
});
