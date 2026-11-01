'use strict';

const https = require('node:https');
const WebSocket = require('ws');
const cfg = require('./src/config');
const { readCredentials } = require('./src/identity');
const { readActivePair, maybeRenew } = require('./src/cert');
const { checkSingbox, manageSingbox } = require('./src/singbox');
const { exportNodes } = require('./src/nodes');
const { proxyUpgrade } = require('./src/proxy');

async function main() {
  const cert = readActivePair(); // Setup must issue/import a valid certificate before startup.
  if (process.env.SINGBOX_ENABLED !== 'false') checkSingbox();
  const subToken = readCredentials().subscriptionToken;
  const routes = new Map(cfg.ROUTES.map(r => [r.path, r.port]));
  const server = https.createServer({ key: cert.key, cert: cert.cert }, (req, res) => {
    const headers = {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    };
    let pathname;
    try { pathname = new URL(req.url, 'https://localhost').pathname; }
    catch { res.writeHead(400, headers).end(); return; }
    if (pathname === `/sub/${subToken}` || pathname === `/nodes/${subToken}`) {
      if (req.method !== 'GET') { res.writeHead(405, headers).end(); return; }
      try {
        const result = exportNodes();
        res.writeHead(200, headers).end(pathname.startsWith('/sub/') ? result.sub : result.nodes);
      } catch (e) {
        console.error('订阅生成失败:', e.message);
        res.writeHead(503, headers).end('Subscription unavailable');
      }
      return;
    }
    if (pathname !== '/') { res.writeHead(404, headers).end('Not Found'); return; }
    res.writeHead(200, headers).end('HTTPS + WebSocket gateway running');
  });

  const testWss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });
  testWss.on('connection', ws => {
    ws.send('WSS connection successful');
    ws.on('message', message => ws.send(`Echo: ${message.toString()}`));
  });
  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, 'https://localhost').pathname; }
    catch { socket.destroy(); return; }
    if (routes.has(pathname)) return proxyUpgrade(req, socket, head, routes.get(pathname));
    if (pathname !== '/ws-test') { socket.destroy(); return; }
    testWss.handleUpgrade(req, socket, head, ws => testWss.emit('connection', ws, req));
  });

  server.on('error', e => {
    console.error('HTTPS 监听失败:', e.message);
    process.exitCode = 1;
  });
  server.listen(cfg.PORT, cfg.BIND_HOST, () => {
    console.log(`HTTPS/WSS ${cfg.DOMAIN}:${cfg.PORT} 已启动`);
    for (const r of cfg.ROUTES) console.log(`${r.type}: ${r.path} → 127.0.0.1:${r.port}`);
    console.log('仅公布节点/订阅文件路径：data/nodes.txt、data/subscription-url.txt');
  });

  const stop = manageSingbox();
  const first = exportNodes();
  console.log(`已生成 ${first.count} 条节点信息（凭证未输出到控制台）`);
  const renewalTimer = setInterval(() => void maybeRenew(server), 12 * 3600000);
  renewalTimer.unref();
  // Check soon after startup as well; no network work if certificate is not near expiry.
  void maybeRenew(server);
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      stop();
      clearInterval(renewalTimer);
      server.close();
      setTimeout(() => process.exit(0), 1200).unref();
    });
  }
}

main().catch(e => {
  console.error('服务未启动:', e.message);
  process.exitCode = 1;
});
