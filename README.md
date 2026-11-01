# Node.js + sing-box 单公网端口三协议 WSS 网关

**VLESS + WS + TLS / VMess + WS + TLS / Trojan + WS + TLS**，共用一个公网 TCP 端口。

本项目是独立整理的 Node.js WSS 网关，不需要 Cloudflare Tunnel（Argo）。Node.js 负责 HTTPS、WebSocket 路由、私密订阅和证书；**sing-box** 在 `127.0.0.1` 上真正处理三种代理协议。

- `/vless` → `127.0.0.1:10003`（sing-box VLESS）
- `/sb` → `127.0.0.1:10001`（sing-box VMess）
- `/trojan` → `127.0.0.1:10002`（sing-box Trojan）
- `/ws-test` → WSS 检测入口
- `/sub/<随机令牌>` → Base64 订阅；`/nodes/<随机令牌>` → 明文节点链接

> 当前架构**不支持把 Hysteria2/TUIC 直接塞进同一个 HTTPS WebSocket 入口**；它们需要相应的 UDP 公网接入。本项目也没有提供 Reality 的 TCP/TLS 分流。

## 0. 环境要求

- Node.js **22 或更高版本**，Linux x86_64 或 ARM64（视 sing-box 可执行文件而定）；需要能安装 npm 依赖、执行额外子进程，以及本机回环端口。
- **一个可访问的 TCP 公网端口**，如 KataBump 的 `20234`，或 VPS 的 `443`。
- 你拥有 DNS 配置权的域名，域名要解析到公网可访问的服务器地址。
- TLS 证书：可以由本项目通过 Cloudflare DNS-01 自动签发/续期，也可以使用你已经准备的证书文件。
- 推荐下载并自行校验 [sing-box 官方发布版](https://github.com/SagerNet/sing-box/releases)；**仓库不捆绑第三方可执行文件**。

## 1. 全新 Node.js 服务器部署

### 第一步：下载/上传文件

将本仓库内容上传到 Node.js 服务的工作目录（例如 KataBump 的 `/home/container`），并确认目录结构：

```text
/home/container/
├── index.js
├── package.json
├── .env.example
├── .env                   # 需要自己创建，切勿上传到 GitHub
├── src/
├── scripts/
├── singbox/
│   └── sing-box           # 自行上传的 Linux 可执行程序
└── data/                  # 运行时自动创建，切勿上传到 GitHub
```

解压 sing-box 的 `.tar.gz`，**只上传 Linux 可执行文件 `sing-box`** 到 `singbox/sing-box`。不要上传 macOS (`darwin-*`) 或 Windows (`.exe`) 程序。在 KataBump Linux x64 + glibc 环境下可选择对应的 `linux-amd64-glibc` 版本。确认运行权限：`chmod +x singbox/sing-box`（初始化脚本也会尝试赋权）。

### 第二步：安装依赖

在项目目录运行：

```bash
npm install
```

若托管平台只能运行 Node.js 的启动命令，请先在本地或其他兼容的 Linux 环境准备依赖，再依平台的文件上传/安装机制部署。不要覆盖已经正常运行的服务。

### 第三步：创建私有 `.env`

复制 `.env.example` 为 `.env`，以使用 Cloudflare DNS-01 自动申请证书为例：

```dotenv
DOMAIN=node.example.com
PORT=20234
ACME_EMAIL=you@example.com
CERT_MODE=cloudflare
CLOUDFLARE_ZONE_ID=你的Cloudflare域名ZoneID
CLOUDFLARE_API_TOKEN=只允许所需Zone读取和DNS编辑权限的令牌
```

**注意：`CLOUDFLARE_ZONE_ID` 是域名的 Zone ID，不是 Account ID。** `DOMAIN` 可以是受该 Zone 管理的子域名（例如 Zone 是 `example.com`、节点域名是 `node.example.com`），无需把它们写成相同值。域名需有正确 DNS 指向，且 Cloudflare DNS-01 要能创建相应的 `_acme-challenge` TXT 记录。

如果域名不由 Cloudflare 托管，也可以使用已有证书（需要你自己负责续期）：

```dotenv
DOMAIN=node.example.com
PORT=20234
CERT_MODE=external
TLS_CERT_FILE=/home/container/cert/fullchain.pem
TLS_KEY_FILE=/home/container/cert/privkey.pem
```

#### 所有环境变量

| 变量 | 必填 | 示例/默认值 | 用途 |
|---|---|---|---|
| `DOMAIN` | 是 | `node.example.com` | 证书名称、SNI、节点服务器地址 |
| `PORT` | 建议 | `20234` | 公网 HTTPS/WSS 端口 |
| `SERVER_PORT` | 否 | 无 | 某些托管商注入的端口，**优先于** `PORT` |
| `CERT_MODE` | 否 | `cloudflare` | `cloudflare` / `external` |
| `ACME_EMAIL` | Cloudflare 模式 | 无 | Let's Encrypt ACME 联系邮箱 |
| `CLOUDFLARE_ZONE_ID` | Cloudflare 模式 | 无 | Cloudflare DNS 区域 ID |
| `CLOUDFLARE_API_TOKEN` | Cloudflare 模式 | 无 | 最小权限 API Token |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | external 模式 | 无 | 现有证书与私钥路径 |
| `BASE_DIR` | 否 | 项目目录 | 运行路径覆盖（主要用作外部进程环境变量） |
| `SINGBOX_BIN` | 否 | `singbox/sing-box` | sing-box 可执行程序路径 |
| `SINGBOX_ENABLED` | 否 | `true` | 设为 `false` 时不启动 sing-box |
| `BIND_HOST` | 否 | `0.0.0.0` | Node.js HTTPS 监听地址 |
| `ACME_DIRECTORY` | 否 | `production` | `staging` 可用来测试 DNS-01，但证书不被浏览器信任 |
| `ACME_DNS_WAIT_SECONDS` | 否 | `60` | 写入 DNS TXT 后等待传播的秒数（10–300） |
| `CERT_RENEW_BEFORE_DAYS` | 否 | `30` | 过期前多少天尝试续期 |

**不需要设置** `UUID`、`VMESS_UUID`、`TROJAN_PASSWORD`、`SUB_TOKEN`、`ARGO_AUTH` 或 `CFIP`。凭证全部由本机安全随机生成，储存在 `data/credentials.json`；本项目不使用 Cloudflare Tunnel，也没有优选域名功能。

### 第四步：首次初始化（需要执行一次）

```bash
npm run setup
# 等同于：node scripts/setup.js
```

初始化会做四件事：

1. 生成独立的 VLESS UUID、VMess UUID、Trojan 密码和订阅访问令牌；重复执行不会覆盖已有值。
2. 生成 `data/singbox.json`，配置三个 sing-box 回环地址的 WebSocket 入站。
3. 通过 `sing-box check -c ...` 检查配置；Cloudflare 模式下首次申请 Let's Encrypt 证书（DNS-01 可能需等待传播）。
4. 生成 `data/nodes.txt`、`data/sub.txt`、`data/subscription-url.txt`。

如果 KataBump 只能通过启动命令运行 Node.js，可临时将启动命令设置为 `node /home/container/scripts/setup.js`；**它执行结束后服务器显示 Offline 是正常的**。然后恢复为长期运行的 `node /home/container/index.js`。

### 第五步：启动

```bash
npm run check
npm start
# 或者：node index.js
```

成功日志应出现三个入站都启动（监听 `127.0.0.1:10003/10001/10002`）。公网仍只有一个端口，例如 `node.example.com:20234`。

### 第六步：获取节点

**不要将节点信息复制到公共 GitHub 仓库或 Issue。** 私下打开服务器文件：

- `data/nodes.txt`：VLESS、VMess、Trojan 三条可直接导入客户端的链接。
- `data/sub.txt`：Base64 订阅文本。
- `data/subscription-url.txt`：带随机令牌的 HTTPS 在线订阅 URL。
- `data/credentials.json`：认证和订阅密钥，仅服务器管理员可访问。

可在 v2rayN/NekoBox 等客户端添加订阅，验证 TLS、节点真连接延迟及实际网站访问。

**迁移/备份提醒：** 若想在重装后保持原节点链接不变，需要私下备份 `data/credentials.json` 和 `data/singbox.json`，并根据证书模式安全备份 `data/certificates/` 或外部证书。不要把这些备份放进 GitHub。删除 `data/` 后再初始化会生成一套全新的节点认证信息。

## 2. 证书与 DNS 注意事项

- Cloudflare DNS-01 用于**域名所有权验证及申请证书**，不等于 Cloudflare Tunnel。
- 这个项目没有启用 Cloudflare Proxy/CDN；如果用 `20234` 这类 Cloudflare 默认不代理的 HTTPS 端口，请将记录设为 **DNS only（灰云）**，让客户端直连服务器。
- 生产模式证书接近到期时由 Node.js 每 12 小时检查一次并尝试续期；新证书写在版本化目录，元信息原子更新，然后热更新 HTTPS 安全上下文。
- 首次启动前必须先 `setup` 申请证书；若选 `external`，需提前上传有效的证书与密钥。续期失败时应排查 DNS 委派、令牌权限、ACME 限额和网络。
- 如果你没有 DNS 控制权（例如别人的二级域名），无法凭空完成该域名的 DNS-01 验证。

## 3. GitHub 开源发布的文件范围

**可以公开：** `index.js`、`src/*.js`、`scripts/*.js`、`tests/*.js`、`package.json`、`.env.example`、`.gitignore`、`README.md`、`LICENSE`、`SECURITY.md`。

**绝对不要公开：** `.env`、`data/`、`cert/`、`singbox/`（其中可能有个人配置和二进制）、真实节点链接/订阅、UUID、密码、Cloudflare Token、证书私钥、ACME 账户密钥、曾使用的日志或备份。

本项目代码按照 MIT 协议提供；它**不包含第三方 sing-box 可执行程序**。灵感参考 [eooce/Sing-box](https://github.com/eooce/Sing-box)（MIT），需保留第三方来源和相关许可要求；sing-box 可执行程序需遵循其原始发布许可证。

建议**新建一个干净的 GitHub 仓库**，不要把当前 KataBump 的整个 `/home/container/` 上传。发布前扫描是否有私人域名、UUID、token、密码、证书私钥或真实订阅链接。

```bash
git init
git add index.js package.json .env.example .gitignore README.md LICENSE SECURITY.md src/ scripts/ tests/
git status
git commit -m "Initial open-source release"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/node-singbox-wss-gateway.git
git push -u origin main
```

> 上述 `git remote` URL 需要先在 GitHub 建好空仓库并替换用户名。首次 `git push` 需要按 GitHub 提示认证。若历史提交过凭证，应先撤销/轮换凭证，不能只依赖删除文件。

## 4. 安全、限制和故障排查

- `data/` 应仅服务器管理员可读，本项目生成的凭证和节点文件权限为 `0600`，目录为 `0700`；避免通过静态文件服务器公开它们。
- sing-box 子进程应由 Node.js 托管，必要时可以通过 `SINGBOX_ENABLED=false` 进行排查。
- 出站为 `direct`，目标网站一般看到的是**部署主机的出口 IP**，不是 Cloudflare IP。
- `sing-box check` 通过只表示配置被当前程序接受，不代表托管商允许外网连接。若客户端超时，请先检查域名、端口、证书和 Node.js 日志。
- 三协议仍然依赖同一公网服务器入口；不是真正的三条物理线路。服务器或公网端口故障时，它们会一起不可用。
- 仅供在服务商规则及适用法律允许的环境中部署。开源项目不能保证任何特定地区/网络的可用性。

## 5. 目录示例

```text
node-singbox-wss-gateway/
├── index.js
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── LICENSE
├── SECURITY.md
├── src/
│   ├── config.js
│   ├── identity.js
│   ├── singbox.js
│   ├── cert.js
│   ├── nodes.js
│   └── proxy.js
├── scripts/
│   ├── setup.js
│   └── check.js
├── tests/
│   └── config.test.js
├── singbox/             # 用户自行创建，不纳入 Git
│   └── sing-box
└── data/                # setup 自动生成，不纳入 Git
    ├── credentials.json
    ├── singbox.json
    ├── nodes.txt
    ├── sub.txt
    ├── subscription-url.txt
    └── certificates/
```

## 致谢

- 协议内核：[SagerNet/sing-box](https://github.com/SagerNet/sing-box)。
- 思路参考：[eooce/Sing-box](https://github.com/eooce/Sing-box)，采用了独立的单端口 WS + 本地回环代理架构，而非复刻其 Argo 一键脚本。
