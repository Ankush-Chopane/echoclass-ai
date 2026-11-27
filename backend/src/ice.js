const crypto = require('crypto');

function buildIceServers(config, userId, now = Date.now()) {
  const servers = [];
  if (config.stunUrls.length) servers.push({ urls: config.stunUrls });
  if (config.turnUrls.length) {
    let username = config.turnUsername;
    let credential = config.turnCredential;
    if (config.turnSharedSecret) {
      username = `${Math.floor(now / 1000) + config.turnCredentialTtlSeconds}:${userId}`;
      credential = crypto.createHmac('sha1', config.turnSharedSecret).update(username).digest('base64');
    }
    servers.push({ urls: config.turnUrls, username, credential, credentialType: 'password' });
  }
  return servers;
}

module.exports = { buildIceServers };
