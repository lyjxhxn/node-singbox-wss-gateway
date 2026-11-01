'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./config');
const { readCredentials, atomicPrivateWrite } = require('./identity');
const { readAndValidateInboundConfig } = require('./singbox');

function generateNodes() {
  const ids = readAndValidateInboundConfig();
  const host = cfg.DOMAIN;
  const port = cfg.PORT;
  const q = p => encodeURIComponent(p);
  const vless = `vless://${ids.vless}@${host}:${port}?encryption=none&security=tls&sni=${host}&type=ws&host=${host}&path=${q('/vless')}#${q('VLESS-WS')}`;
  const payload = {v: '2', ps: 'VMess-WS', add: host, port: String(port),
    id: ids.vmess, aid: '0', scy: 'auto', net: 'ws', type: 'none', host,
    path: '/sb', tls: 'tls', sni: host};
  const vmess = 'vmess://' + Buffer.from(JSON.stringify(payload)).toString('base64');
  const trojan = `trojan://${encodeURIComponent(ids.trojan)}@${host}:${port}?security=tls&sni=${host}&type=ws&host=${host}&path=${q('/trojan')}#${q('Trojan-WS')}`;
  return [vless, vmess, trojan];
}

function exportNodes() {
  const token = readCredentials().subscriptionToken;
  const nodes = generateNodes().join('\n') + '\n';
  const sub = Buffer.from(nodes).toString('base64') + '\n';
  const baseUrl = `https://${cfg.DOMAIN}:${cfg.PORT}`;
  atomicPrivateWrite(path.join(cfg.DATA_DIR, 'nodes.txt'), nodes);
  atomicPrivateWrite(path.join(cfg.DATA_DIR, 'sub.txt'), sub);
  atomicPrivateWrite(path.join(cfg.DATA_DIR, 'subscription-url.txt'),
    `Base64 订阅：${baseUrl}/sub/${token}\n节点明文：${baseUrl}/nodes/${token}\n`);
  return { nodes, sub, token, count: 3 };
}

module.exports = { generateNodes, exportNodes };
