'use strict';

const net = require('node:net');

// HTTP/1.1 WebSocket Upgrade TCP tunnel, TLS already terminated by the Node gateway.
function proxyUpgrade(req, client, head, backendPort) {
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  const connection = String(req.headers.connection || '').toLowerCase();
  if (req.method !== 'GET' || upgrade !== 'websocket' ||
    !connection.split(',').some(v => v.trim() === 'upgrade') ||
    !req.headers['sec-websocket-key']) {
    client.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    return;
  }
  const upstream = net.connect({ host: '127.0.0.1', port: backendPort });
  let connected = false;
  const timer = setTimeout(() => upstream.destroy(new Error('本地服务连接超时')), 10000);
  timer.unref();
  upstream.once('connect', () => {
    connected = true;
    clearTimeout(timer);
    if (client.destroyed) return upstream.destroy();
    const headers = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      headers.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i+1]}`);
    }
    upstream.write(headers.join('\r\n') + '\r\n\r\n', 'latin1');
    if (head?.length) upstream.write(head);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  upstream.on('error', error => {
    clearTimeout(timer);
    console.error(`[gateway] 本地端口 ${backendPort} 转发失败: ${error.message}`);
    if (client.destroyed) return;
    if (!connected) client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    else client.destroy();
  });
  upstream.on('close', () => {
    clearTimeout(timer);
    if (connected && !client.destroyed) client.destroy();
  });
  client.on('error', () => upstream.destroy());
  client.on('close', () => upstream.destroy());
}
module.exports = { proxyUpgrade };
