const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER || 'admin';
const BASIC_AUTH_PASS = process.env.BASIC_AUTH_PASS || '373536';

function basicAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="X AutoPilot"');
    return res.status(401).send('Authentication required');
  }

  const credentials = Buffer.from(header.slice(6), 'base64').toString();
  const [user, pass] = credentials.split(':');

  if (user === BASIC_AUTH_USER && pass === BASIC_AUTH_PASS) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="X AutoPilot"');
  return res.status(401).send('Invalid credentials');
}

module.exports = basicAuth;
