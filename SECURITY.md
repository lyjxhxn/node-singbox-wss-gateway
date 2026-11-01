# Security Policy

Please do not publish actual node URLs, UUIDs, passwords, .env, access tokens, or TLS/ACME private keys in public issues, pull requests or logs.

For a suspected credential leak:
1. Revoke or rotate the exposed Cloudflare API token immediately.
2. Replace affected UUIDs, passwords and subscription token in the server's private files (restart and distribute new client links).
3. Replace exposed TLS/ACME private keys and reissue the certificate as appropriate.
4. Remove leaked secrets from public repository history and collaborators' clones where possible; deleting the visible file alone does not erase commit history.

Use the least-privileged API token and keep runtime files outside the public source tree (this project ignores `data/`).
