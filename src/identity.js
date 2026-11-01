'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./config');
const CREDENTIALS_PATH = path.join(cfg.DATA_DIR, 'credentials.json');

function atomicPrivateWrite(file, contents) {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, contents, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function validateCredentials(c) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(c?.vlessUuid) || !uuid.test(c?.vmessUuid) ||
      typeof c?.trojanPassword !== 'string' || c.trojanPassword.length < 24 ||
      !/^[a-f0-9]{48,128}$/i.test(c?.subscriptionToken || '')) {
    throw new Error('data/credentials.json 缺少有效 UUID、Trojan 密码或订阅令牌');
  }
}

function loadOrCreateCredentials() {
  cfg.ensureDirectories();
  if (fs.existsSync(CREDENTIALS_PATH)) {
    const stored = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    validateCredentials(stored);
    fs.chmodSync(CREDENTIALS_PATH, 0o600);
    return stored;
  }
  const c = {
    vlessUuid: crypto.randomUUID(),
    vmessUuid: crypto.randomUUID(),
    trojanPassword: crypto.randomBytes(32).toString('hex'),
    subscriptionToken: crypto.randomBytes(32).toString('hex')
  };
  atomicPrivateWrite(CREDENTIALS_PATH, JSON.stringify(c, null, 2) + '\n');
  return c;
}

function readCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) throw new Error('缺少凭证，请先运行 npm run setup');
  const c = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  validateCredentials(c);
  return c;
}

module.exports = { CREDENTIALS_PATH, atomicPrivateWrite, loadOrCreateCredentials, readCredentials };
