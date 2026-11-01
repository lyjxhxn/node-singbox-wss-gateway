'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tls = require('node:tls');
const acme = require('acme-client');
const cfg = require('./config');
const { atomicPrivateWrite } = require('./identity');

const ACTIVE_FILE = path.join(cfg.CERT_DIR, 'active.json');
const ACCOUNT_FILE = path.join(cfg.CERT_DIR, 'account.pem');
const RETRY_FILE = path.join(cfg.CERT_DIR, 'retry.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let issuing = false;

function checkedPair(cert, key) {
  const x509 = new crypto.X509Certificate(cert);
  if (!x509.checkHost(cfg.DOMAIN)) throw new Error(`证书不包含域名 ${cfg.DOMAIN}`);
  if (Date.parse(x509.validTo) <= Date.now()) throw new Error('证书已经过期');
  tls.createSecureContext({ key, cert });
  return {cert, key, expiry: Date.parse(x509.validTo)};
}

function readActivePair() {
  if (cfg.CERT_MODE === 'external') {
    const files = cfg.externalPaths();
    return checkedPair(fs.readFileSync(files.cert, 'utf8'), fs.readFileSync(files.key, 'utf8'));
  }
  const manifest = JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8'));
  // Manifest points only to an internal generated directory, never arbitrary user input.
  if (!/^v\d{13}-[a-f0-9]{8}$/.test(manifest.version)) {
    throw new Error('证书版本信息异常');
  }
  const dir = path.join(cfg.CERT_DIR, manifest.version);
  return checkedPair(fs.readFileSync(path.join(dir, 'fullchain.pem'), 'utf8'),
    fs.readFileSync(path.join(dir, 'privkey.pem'), 'utf8'));
}

async function cfApi(method, endpoint, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.CF_TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000)
  });
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(`Cloudflare API 错误：${JSON.stringify(json.errors || [])}`);
  }
  return json.result;
}

async function verifyZone() {
  const zone = await cfApi('GET', `/zones/${encodeURIComponent(cfg.CF_ZONE_ID)}`);
  const name = String(zone?.name || '').toLowerCase();
  if (zone.status !== 'active' || (cfg.DOMAIN !== name && !cfg.DOMAIN.endsWith('.' + name))) {
    throw new Error(`域名 ${cfg.DOMAIN} 不在 Cloudflare Zone ${name} 下，或 Zone 未激活`);
  }
}

async function issueCertificate() {
  if (issuing) return null;
  issuing = true;
  try {
    cfg.checkCertSettings();
    cfg.ensureDirectories();
    await verifyZone();
    let accountKey;
    if (fs.existsSync(ACCOUNT_FILE)) accountKey = fs.readFileSync(ACCOUNT_FILE);
    else {
      accountKey = await acme.crypto.createPrivateKey();
      atomicPrivateWrite(ACCOUNT_FILE, accountKey);
    }
    const client = new acme.Client({
      directoryUrl: cfg.ACME_DIRECTORY === 'staging'
        ? acme.directory.letsencrypt.staging
        : acme.directory.letsencrypt.production,
      accountKey
    });
    // Only the requested hostname; unlike a wildcard cert, this requires one DNS authorization.
    const [newKey, csr] = await acme.crypto.createCsr({
      commonName: cfg.DOMAIN,
      altNames: [cfg.DOMAIN]
    });
    const createdRecords = new Map();
    const cert = await client.auto({
      csr,
      email: cfg.EMAIL,
      termsOfServiceAgreed: true,
      challengePriority: ['dns-01'],
      challengeCreateFn: async (authz, challenge, txtValue) => {
        const challengeDomain = String(authz.identifier.value).replace(/^\*\./, '');
        const record = await cfApi('POST', `/zones/${encodeURIComponent(cfg.CF_ZONE_ID)}/dns_records`, {
          type: 'TXT', name: `_acme-challenge.${challengeDomain}`, content: txtValue, ttl: 1
        });
        createdRecords.set(challenge.token, record.id);
        const wait = Number(process.env.ACME_DNS_WAIT_SECONDS || 60);
        await sleep((Number.isFinite(wait) && wait >= 10 ? Math.min(wait, 300) : 60) * 1000);
      },
      challengeRemoveFn: async (_authz, challenge) => {
        const id = createdRecords.get(challenge.token);
        if (!id) return;
        try {
          await cfApi('DELETE', `/zones/${encodeURIComponent(cfg.CF_ZONE_ID)}/dns_records/${encodeURIComponent(id)}`);
        } catch (e) {
          console.error('DNS TXT 记录清理失败（请手动检查）:', e.message);
        }
        createdRecords.delete(challenge.token);
      }
    });
    checkedPair(cert, newKey);
    const version = `v${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const versionDir = path.join(cfg.CERT_DIR, version);
    fs.mkdirSync(versionDir, { mode: 0o700 });
    atomicPrivateWrite(path.join(versionDir, 'fullchain.pem'), cert);
    atomicPrivateWrite(path.join(versionDir, 'privkey.pem'), newKey);
    // Atomic manifest replacement: a restart always reads a matched certificate/key pair.
    atomicPrivateWrite(ACTIVE_FILE, JSON.stringify({version}, null, 2) + '\n');
    if (fs.existsSync(RETRY_FILE)) fs.rmSync(RETRY_FILE);
    console.log('已签发并激活新证书，证书内容与密钥不输出到日志。');
    return readActivePair();
  } finally {
    issuing = false;
  }
}

async function ensureInitialCertificate() {
  cfg.checkCertSettings();
  if (cfg.CERT_MODE === 'external') return readActivePair();
  try { return readActivePair(); }
  catch (e) {
    if (fs.existsSync(ACTIVE_FILE)) throw e;
    console.log('未发现证书：开始通过 Cloudflare DNS-01 申请首张证书。');
    return issueCertificate();
  }
}

async function maybeRenew(server) {
  if (cfg.CERT_MODE !== 'cloudflare' || issuing) return;
  let current;
  try { current = readActivePair(); }
  catch (e) { console.error('证书读取异常，请先运行 npm run setup：', e.message); return; }
  const threshold = Number(process.env.CERT_RENEW_BEFORE_DAYS || 30);
  const days = Number.isFinite(threshold) && threshold >= 1 ? threshold : 30;
  if (current.expiry - Date.now() > days * 86400000) return;
  try {
    if (fs.existsSync(RETRY_FILE)) {
      const retry = JSON.parse(fs.readFileSync(RETRY_FILE, 'utf8'));
      if (retry.nextAttempt > Date.now()) return;
    }
    // Backoff if ACME / DNS operation fails, to avoid hitting issuance rate limits.
    atomicPrivateWrite(RETRY_FILE, JSON.stringify({ nextAttempt: Date.now() + 6 * 3600000 }) + '\n');
    const pair = await issueCertificate();
    if (pair && server) server.setSecureContext({ key: pair.key, cert: pair.cert });
  } catch (e) {
    console.error('自动续期失败，当前仍使用原证书:', e.message);
  }
}

module.exports = { readActivePair, ensureInitialCertificate, maybeRenew, checkedPair };
