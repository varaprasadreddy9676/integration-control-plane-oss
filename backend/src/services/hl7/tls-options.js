'use strict';

const fs = require('fs');

function readSecretOrFile(value, filePath, field) {
  if (value) return value;
  if (!filePath) return undefined;
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    const err = new Error(`Unable to read HL7 TLS ${field} file: ${error.message}`);
    err.code = 'HL7_TLS_CONFIG_ERROR';
    throw err;
  }
}

function normalizeCa(value, filePath) {
  const ca = readSecretOrFile(value, filePath, 'ca');
  if (!ca) return undefined;
  return Array.isArray(ca) ? ca : [ca];
}

function normalizeTlsConfig(config = {}, { server = false } = {}) {
  const tlsConfig = config.tls || config.tlsConfig || {};
  if (!tlsConfig.enabled) return null;

  const key = readSecretOrFile(tlsConfig.key, tlsConfig.keyPath, 'key');
  const cert = readSecretOrFile(tlsConfig.cert, tlsConfig.certPath, 'cert');

  if (server && (!key || !cert)) {
    const err = new Error('HL7 TLS listener requires tls.key/tls.cert or tls.keyPath/tls.certPath');
    err.code = 'HL7_TLS_CONFIG_ERROR';
    throw err;
  }

  return {
    key,
    cert,
    ca: normalizeCa(tlsConfig.ca, tlsConfig.caPath),
    passphrase: tlsConfig.passphrase,
    requestCert: Boolean(tlsConfig.requestCert || tlsConfig.requireClientCert),
    rejectUnauthorized: tlsConfig.rejectUnauthorized !== false,
    minVersion: tlsConfig.minVersion || 'TLSv1.2',
    servername: tlsConfig.servername || tlsConfig.serverName,
  };
}

module.exports = {
  normalizeTlsConfig,
};
