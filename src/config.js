'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(process.env.BASE_DIR || path.resolve(__dirname, '..'));
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

function requirePort(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    throw new Error('PORT/SERVER_PORT 必须是 1–65535 之间的整数');
  }
  return number;
}

const DOMAIN = String(process.env.DOMAIN || '').trim().toLowerCase();
if (!/^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(DOMAIN)) {
  throw new Error('请在 .env 中填写有效 DOMAIN（例如 node.example.com）');
}

const PORT = requirePort(process.env.SERVER_PORT || process.env.PORT || '20234');
const CERT_MODE = String(process.env.CERT_MODE || 'cloudflare').toLowerCase();
if (!['cloudflare', 'external'].includes(CERT_MODE)) {
  throw new Error('CERT_MODE 只能是 cloudflare 或 external');
}
const DATA_DIR = path.join(ROOT, 'data');
const SINGBOX_DIR = path.join(ROOT, 'singbox');
const SINGBOX_BIN = path.resolve(process.env.SINGBOX_BIN || path.join(SINGBOX_DIR, 'sing-box'));
const SINGBOX_CONFIG = path.join(DATA_DIR, 'singbox.json');
const CERT_DIR = path.join(DATA_DIR, 'certificates');
const EMAIL = String(process.env.ACME_EMAIL || '').trim();
const CF_ZONE_ID = String(process.env.CLOUDFLARE_ZONE_ID || '').trim();
const CF_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';
const ACME_DIRECTORY = process.env.ACME_DIRECTORY || 'production';
if (!['production', 'staging'].includes(ACME_DIRECTORY)) throw new Error('ACME_DIRECTORY 只能为 production 或 staging');

function checkCertSettings() {
  if (CERT_MODE === 'cloudflare') {
    if (!EMAIL || !CF_ZONE_ID || !CF_TOKEN) {
      throw new Error('CERT_MODE=cloudflare 时必须填写 ACME_EMAIL、CLOUDFLARE_ZONE_ID、CLOUDFLARE_API_TOKEN');
    }
  } else if (!process.env.TLS_CERT_FILE || !process.env.TLS_KEY_FILE) {
    throw new Error('CERT_MODE=external 时需要 TLS_CERT_FILE 和 TLS_KEY_FILE');
  }
}

function externalPaths() {
  return {
    cert: path.resolve(ROOT, process.env.TLS_CERT_FILE || 'not-configured.pem'),
    key: path.resolve(ROOT, process.env.TLS_KEY_FILE || 'not-configured.key')
  };
}

function ensureDirectories() {
  for (const dir of [DATA_DIR, CERT_DIR]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
  }
}

const ROUTES = Object.freeze([
  { type: 'vless', tag: 'vless-ws-in', path: '/vless', port: 10003 },
  { type: 'vmess', tag: 'vmess-ws-in', path: '/sb', port: 10001 },
  { type: 'trojan', tag: 'trojan-ws-in', path: '/trojan', port: 10002 }
]);

module.exports = {
  ROOT, DOMAIN, PORT, CERT_MODE, DATA_DIR, CERT_DIR, SINGBOX_DIR,
  SINGBOX_BIN, SINGBOX_CONFIG, EMAIL, CF_ZONE_ID, CF_TOKEN, BIND_HOST,
  ACME_DIRECTORY, ROUTES, checkCertSettings, externalPaths, ensureDirectories
};
