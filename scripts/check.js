'use strict';
const cfg = require('../src/config');
const { checkSingbox } = require('../src/singbox');
const { readActivePair } = require('../src/cert');
const { readCredentials } = require('../src/identity');
try {
  readCredentials();
  checkSingbox();
  const tls = readActivePair();
  console.log(`检测通过：${cfg.DOMAIN}:${cfg.PORT}`);
  console.log(`证书到期：${new Date(tls.expiry).toISOString()}`);
  console.log('VLESS /vless、VMess /sb、Trojan /trojan 已配置；仅验证配置，尚未检测公网连接。');
} catch (e) {
  console.error('检查失败:', e.message);
  process.exitCode = 1;
}
