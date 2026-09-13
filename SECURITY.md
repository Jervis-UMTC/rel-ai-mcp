# Security Policy

Rel.AI's security model, trust boundaries, credential handling, workspace protections, Electron boundary, update path, and Secure MCP Tunnel boundary are documented in [docs/SECURITY.md](docs/SECURITY.md).

## Reporting a vulnerability

Please do not report suspected security vulnerabilities in a public GitHub issue.

Use GitHub's private vulnerability reporting flow when it is available for this repository:

<https://github.com/Kyne0328/rel-ai-chatgpt-web-harness/security/advisories/new>

If that private reporting flow is unavailable, do **not** publish exploit details, credentials, private repository content, or sensitive diagnostics in a normal issue. Open a minimal issue stating that you need a private security contact, without including the vulnerability details.

Please include:

- the affected Rel.AI version or commit;
- operating system and architecture when relevant;
- the affected component, capability, or trust boundary;
- clear reproduction steps using non-sensitive test data;
- the security impact you observed or can demonstrate;
- any relevant logs with secrets, local paths, repository content, and personal data removed.

## Supported versions

Security fixes target the latest stable release and current `main` branch. Users should update to the latest published Rel.AI release when a security fix is available. Older releases may not receive security fixes unless explicitly stated.

## Security scope

Important reportable boundaries include workspace containment, sensitive-file handling, MCP/dashboard authorization, task/workspace isolation, command execution, Git publishing, browser sessions, computer-control opt-in, Electron IPC/navigation, Secure MCP Tunnel credentials, update integrity, and accidental export of sensitive content through telemetry or diagnostics.

Reports about third-party services should also be sent to the relevant provider when the issue is outside Rel.AI's code or configuration boundary.

## Safe reporting

Test only systems, repositories, accounts, and data you own or are explicitly authorized to test. Do not degrade third-party services, access other users' data, or include real secrets in a proof of concept.

## Security architecture

For the detailed security model and remaining trust boundaries, see [docs/SECURITY.md](docs/SECURITY.md).
