'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'singbox-wss-test-'));
process.env.BASE_DIR = base;
process.env.DOMAIN = 'edge.example.com';
process.env.PORT = '20234';
process.env.CERT_MODE = 'external';
const cfg = require('../src/config');
const { loadOrCreateCredentials } = require('../src/identity');
const { ensureSingboxConfig, readAndValidateInboundConfig } = require('../src/singbox');
const { generateNodes, exportNodes } = require('../src/nodes');

test('first run: random secrets are valid and persist across repeated setup', () => {
  const first = loadOrCreateCredentials();
  const second = loadOrCreateCredentials();
  assert.deepEqual(first, second);
  assert.notEqual(first.vlessUuid, first.vmessUuid);
  assert.equal(fs.statSync(path.join(base, 'data/credentials.json')).mode & 0o777, 0o600);
});

test('generated sing-box JSON includes three independent loopback WS inbounds', () => {
  ensureSingboxConfig();
  const doc = JSON.parse(fs.readFileSync(cfg.SINGBOX_CONFIG, 'utf8'));
  assert.equal(doc.inbounds.length, 3);
  for (const route of cfg.ROUTES) {
    const inbound = doc.inbounds.find(x => x.type === route.type);
    assert.equal(inbound.listen, '127.0.0.1');
    assert.equal(inbound.listen_port, route.port);
    assert.equal(inbound.transport.path, route.path);
  }
  assert.equal(Object.keys(readAndValidateInboundConfig()).length, 3);
});

test('generate vless/vmess/trojan links with real matching ids, no public placeholder', () => {
  const ids = readAndValidateInboundConfig();
  const [vless, vmess, trojan] = generateNodes();
  assert.match(vless, /^vless:\/\//);
  assert.ok(vless.includes(ids.vless));
  const payload = JSON.parse(Buffer.from(vmess.substring('vmess://'.length), 'base64').toString());
  assert.equal(payload.id, ids.vmess);
  assert.equal(payload.path, '/sb');
  assert.ok(trojan.includes(ids.trojan));
  const out = exportNodes();
  assert.equal(out.count, 3);
  assert.match(out.sub, /^[A-Za-z0-9+/=]+\n$/);
  assert.equal(fs.statSync(path.join(base, 'data/nodes.txt')).mode & 0o777, 0o600);
});

test('rerun does not overwrite manually adjusted sing-box config', () => {
  let text = fs.readFileSync(cfg.SINGBOX_CONFIG, 'utf8');
  text = text.replace('"level": "info"', '"level": "error"');
  fs.writeFileSync(cfg.SINGBOX_CONFIG, text);
  ensureSingboxConfig();
  assert.ok(fs.readFileSync(cfg.SINGBOX_CONFIG, 'utf8').includes('"level": "error"'));
});
