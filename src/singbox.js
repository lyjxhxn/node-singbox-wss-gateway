'use strict';

const fs = require('node:fs');
const { execFileSync, spawn } = require('node:child_process');
const cfg = require('./config');
const { atomicPrivateWrite, loadOrCreateCredentials } = require('./identity');

function initialConfig(credentials) {
  return {
    log: { level: 'info', timestamp: true },
    inbounds: cfg.ROUTES.map(route => {
      const user = route.type === 'trojan'
        ? { name: 'trojan-user', password: credentials.trojanPassword }
        : { name: `${route.type}-user`, uuid: route.type === 'vless' ? credentials.vlessUuid : credentials.vmessUuid };
      if (route.type === 'vmess') user.alterId = 0;
      return {
        type: route.type, tag: route.tag,
        listen: '127.0.0.1', listen_port: route.port,
        users: [user], transport: { type: 'ws', path: route.path }
      };
    }),
    outbounds: [{ type: 'direct', tag: 'direct' }],
    route: { rules: [{ ip_is_private: true, action: 'reject' }], final: 'direct' }
  };
}

function ensureSingboxConfig() {
  const creds = loadOrCreateCredentials();
  if (!fs.existsSync(cfg.SINGBOX_CONFIG)) {
    atomicPrivateWrite(cfg.SINGBOX_CONFIG, JSON.stringify(initialConfig(creds), null, 2) + '\n');
  }
  return cfg.SINGBOX_CONFIG;
}

function readAndValidateInboundConfig() {
  const config = JSON.parse(fs.readFileSync(cfg.SINGBOX_CONFIG, 'utf8'));
  if (!Array.isArray(config.inbounds)) throw new Error('sing-box 缺少 inbounds');
  const selected = {};
  for (const route of cfg.ROUTES) {
    const match = config.inbounds.find(i => i.type === route.type &&
      i.listen === '127.0.0.1' && Number(i.listen_port) === route.port &&
      i.transport?.type === 'ws' && i.transport.path === route.path);
    if (!match) throw new Error(`${route.type} 入站 ${route.path}/${route.port} 不匹配`);
    const identity = match.users?.[0];
    const secret = route.type === 'trojan' ? identity?.password : identity?.uuid;
    if (typeof secret !== 'string' || !secret) throw new Error(`${route.type} 凭证缺失`);
    selected[route.type] = secret;
  }
  return selected;
}

function checkSingbox() {
  if (!fs.existsSync(cfg.SINGBOX_BIN)) {
    throw new Error(`找不到 sing-box 可执行文件：${cfg.SINGBOX_BIN}；请先下载对应 Linux 架构版本并解压上传`);
  }
  fs.chmodSync(cfg.SINGBOX_BIN, 0o755);
  execFileSync(cfg.SINGBOX_BIN, ['check', '-c', cfg.SINGBOX_CONFIG], {
    stdio: 'pipe', timeout: 25000
  });
  return readAndValidateInboundConfig();
}

function manageSingbox() {
  if (process.env.SINGBOX_ENABLED === 'false') {
    console.log('[sing-box] SINGBOX_ENABLED=false，已跳过');
    return () => {};
  }
  let child = null;
  let attempts = 0;
  let restart = null;
  let stopping = false;
  function launch() {
    if (stopping) return;
    child = spawn(cfg.SINGBOX_BIN, ['run', '-c', cfg.SINGBOX_CONFIG], {
      cwd: cfg.ROOT, stdio: ['ignore', 'pipe', 'pipe']
    });
    const launched = Date.now();
    const current = child;
    current.stdout.on('data', d => process.stdout.write(`[sing-box] ${d}`));
    current.stderr.on('data', d => process.stderr.write(`[sing-box] ${d}`));
    current.on('spawn', () => console.log('[sing-box] PID:', current.pid));
    current.on('error', e => console.error('[sing-box] 启动失败:', e.message));
    current.on('close', (code, signal) => {
      if (current !== child || stopping) return;
      child = null;
      console.error(`[sing-box] 进程退出 code=${code} signal=${signal}`);
      if (Date.now() - launched > 60000) attempts = 0;
      if (++attempts > 3) return console.error('[sing-box] 重启次数超限，请检查日志');
      restart = setTimeout(launch, 15000);
    });
  }
  launch();
  return () => {
    stopping = true;
    if (restart) clearTimeout(restart);
    if (child && !child.killed) child.kill('SIGTERM');
  };
}

module.exports = { initialConfig, ensureSingboxConfig, readAndValidateInboundConfig, checkSingbox, manageSingbox };
