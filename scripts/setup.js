'use strict';

const cfg = require('../src/config');
const { loadOrCreateCredentials } = require('../src/identity');
const { ensureSingboxConfig, checkSingbox } = require('../src/singbox');
const { ensureInitialCertificate } = require('../src/cert');
const { exportNodes } = require('../src/nodes');

(async () => {
  cfg.ensureDirectories();
  cfg.checkCertSettings();
  loadOrCreateCredentials();
  ensureSingboxConfig();
  checkSingbox();
  console.log('sing-box 程序和三协议配置检查通过。');
  const pair = await ensureInitialCertificate();
  console.log(`TLS 证书到期时间：${new Date(pair.expiry).toISOString()}`);
  const exported = exportNodes();
  console.log(`${exported.count} 条节点已生成；请私下查看 data/nodes.txt 和 data/subscription-url.txt`);
  console.log('初始化成功。正式启动：node index.js');
})().catch(e => {
  console.error('初始化失败:', e.message);
  process.exitCode = 1;
});
