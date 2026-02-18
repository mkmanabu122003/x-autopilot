describe('basicAuth middleware', () => {
  const originalUser = process.env.BASIC_AUTH_USER;
  const originalPass = process.env.BASIC_AUTH_PASS;

  let basicAuth;
  let req, res, next;

  function setupMocks() {
    req = { headers: {}, path: '/api/some-route' };
    res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      setHeader: jest.fn()
    };
    next = jest.fn();
  }

  afterEach(() => {
    if (originalUser !== undefined) {
      process.env.BASIC_AUTH_USER = originalUser;
    } else {
      delete process.env.BASIC_AUTH_USER;
    }
    if (originalPass !== undefined) {
      process.env.BASIC_AUTH_PASS = originalPass;
    } else {
      delete process.env.BASIC_AUTH_PASS;
    }
    jest.resetModules();
  });

  describe('認証が未設定の場合', () => {
    beforeEach(() => {
      delete process.env.BASIC_AUTH_USER;
      delete process.env.BASIC_AUTH_PASS;
      basicAuth = require('../../server/middleware/basicAuth');
      setupMocks();
    });

    test('認証なしで次のミドルウェアに進む', () => {
      basicAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('認証が設定済みの場合', () => {
    beforeEach(() => {
      process.env.BASIC_AUTH_USER = 'admin';
      process.env.BASIC_AUTH_PASS = 'password123';
      basicAuth = require('../../server/middleware/basicAuth');
      setupMocks();
    });

    test('正しい認証情報で次に進む', () => {
      const credentials = Buffer.from('admin:password123').toString('base64');
      req.headers.authorization = `Basic ${credentials}`;
      basicAuth(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('Authorization ヘッダーがない場合は 401', () => {
      basicAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith('Authentication required');
      expect(next).not.toHaveBeenCalled();
    });

    test('Basic 以外のスキームは 401', () => {
      req.headers.authorization = 'Bearer some-token';
      basicAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('不正なユーザー名は 401', () => {
      const credentials = Buffer.from('wrong:password123').toString('base64');
      req.headers.authorization = `Basic ${credentials}`;
      basicAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith('Invalid credentials');
      expect(next).not.toHaveBeenCalled();
    });

    test('不正なパスワードは 401', () => {
      const credentials = Buffer.from('admin:wrongpass').toString('base64');
      req.headers.authorization = `Basic ${credentials}`;
      basicAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('WWW-Authenticate ヘッダーが設定される', () => {
      basicAuth(req, res, next);
      expect(res.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        'Basic realm="X AutoPilot"'
      );
    });

    test('cron エンドポイント (/api/cron/) は basic auth をスキップする', () => {
      req.path = '/api/cron/scheduled';
      req.headers.authorization = 'Bearer some-cron-secret';
      basicAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('cron エンドポイント (/cron/) は basic auth をスキップする', () => {
      req.path = '/cron/auto-post';
      req.headers.authorization = 'Bearer some-cron-secret';
      basicAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('cron 以外のエンドポイントは引き続き basic auth を要求する', () => {
      req.path = '/api/tweets';
      req.headers.authorization = 'Bearer some-token';
      basicAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
