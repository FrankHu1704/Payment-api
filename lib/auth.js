function getBearerToken(req) {
  const auth = req.headers['authorization'] || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

function requireBearer(req, envVarName) {
  const expected = process.env[envVarName];
  const token = getBearerToken(req);
  return Boolean(expected) && token === expected;
}

module.exports = { getBearerToken, requireBearer };
