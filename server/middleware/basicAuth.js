const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER;
const BASIC_AUTH_PASS = process.env.BASIC_AUTH_PASS;

function basicAuth(req, res, next) {
  if (!BASIC_AUTH_USER || !BASIC_AUTH_PASS) {
    return next();
  }

  // Skip basic auth for cron endpoints only when CRON_SECRET is configured
  // (authentication is delegated to verifyCronSecret in the cron route)
  if ((req.path.startsWith('/api/cron/') || req.path.startsWith('/cron/')) && process.env.CRON_SECRET) {
    return next();
  }

  const header = req.headers.authorization;

  const isApiRoute = req.path.startsWith('/api/');

  if (!header || !header.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="X AutoPilot"');
    return isApiRoute
      ? res.status(401).json({ error: 'Authentication required' })
      : res.status(401).send('Authentication required');
  }

  const credentials = Buffer.from(header.slice(6), 'base64').toString();
  const [user, pass] = credentials.split(':');

  if (user === BASIC_AUTH_USER && pass === BASIC_AUTH_PASS) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="X AutoPilot"');
  return isApiRoute
    ? res.status(401).json({ error: 'Invalid credentials' })
    : res.status(401).send('Invalid credentials');
}

module.exports = basicAuth;
