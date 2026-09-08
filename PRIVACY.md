# Rel.AI MCP Privacy Policy

**Effective date: September 8, 2026**

This Privacy Policy explains how Rel.AI MCP ("Rel.AI") handles information when you use the Rel.AI desktop application, local MCP runtime, repository tools, browser/computer capabilities, update surfaces, and related project resources maintained by Kyne ("the maintainer").

Rel.AI is designed as a local-first development harness for ChatGPT. The repository and runtime remain on your computer, but information that a task needs can be returned to ChatGPT through the connection you configure. This policy describes that boundary explicitly.

## 1. Information Rel.AI processes locally

Depending on the features you use, Rel.AI can process information such as:

- project files, file metadata, diffs, repository structure, Git state, and configured remotes;
- commands, command output, validation results, managed-process state, and task activity;
- workspace aliases and configuration;
- task/session history, saved local context, memory/learning state, and validation evidence;
- local analytics counters and timing information;
- troubleshooting logs, update state, indexes, caches, and temporary command-output files;
- browser session state when you use Rel.AI browser capabilities, including a persistent local browser profile when that mode is selected;
- screenshots, clipboard text, application information, and pointer/keyboard actions when you explicitly enable or request computer-control features; and
- application preferences and desktop lifecycle state.

Rel.AI does not require a hosted copy of your repository in order to operate.

## 2. Information sent through your ChatGPT connection

When ChatGPT requests a Rel.AI tool action, Rel.AI returns bounded tool inputs and results needed for that request. Depending on the action, those results can include file excerpts, diffs, repository metadata, command arguments or output, validation results, process information, screenshots, browser content, selected local files, workspace aliases, task identifiers, or other local information relevant to the task.

The supported ChatGPT connection uses OpenAI Secure MCP Tunnel. Information sent to ChatGPT or other OpenAI services is handled by OpenAI under the terms, privacy settings, and data controls that apply to your OpenAI account or workspace. The Rel.AI maintainer does not control OpenAI's independent retention, training, or account policies.

Rel.AI does not upload your entire repository merely because a workspace is configured. Data is transferred when a requested capability needs to return it to ChatGPT or another service you explicitly use.

## 3. Credentials and sensitive configuration

The Rel.AI desktop app stores the OpenAI tunnel runtime API key using Electron `safeStorage` when the operating system supports it. The normal renderer receives only whether a runtime key is configured, not the stored key itself.

Rel.AI also uses a private local bearer credential for the loopback MCP service. That credential is intended to remain on the computer running Rel.AI.

You are responsible for protecting repository credentials, tunnel credentials, private keys, access tokens, and other secrets. Do not place secrets in public issues, screenshots, or diagnostic exports.

## 4. Local analytics

Rel.AI records aggregate local analytics for product activity such as action counts, outcomes, reliability categories, timing, tools, and project/workspace aggregates. Current local analytics are retained for approximately **180 days** and are pruned automatically.

Local analytics do **not** store prompts, file paths, file contents, command output, action results, or raw error details.

You can clear local analytics from the Analytics page without deleting project files, task history, memory, settings, or telemetry configuration.

## 5. Optional external telemetry

External OpenTelemetry tracing is **off by default** and requires `telemetry.enabled` to be explicitly enabled. Merely configuring an OTLP endpoint does not turn telemetry on.

When enabled, operational traces can include tool names, project aliases, task identifiers, client/runtime information, timings, and summarized commands. Rel.AI's telemetry boundary excludes prompts, file contents, command output, and raw exception messages from exported traces.

If you configure or enable an external OTLP endpoint, the operator of that endpoint controls its own storage, retention, security, and deletion practices. Rel.AI cannot retroactively delete data from an external telemetry system that it does not operate.

## 6. Local retention and deletion

Most Rel.AI-owned state remains on your computer until it is cleared, replaced, expired by a feature-specific retention rule, or removed by you. The desktop app provides controls for clearing local analytics, task/activity history, troubleshooting logs, temporary output, and other local data.

Logging out can remove the saved OpenAI tunnel connection and, if you choose **Clear all local data**, delete Rel.AI-owned local application data while leaving your configured project folders and project files intact.

Rel.AI's desktop uninstall configuration can preserve application data. If you want Rel.AI-owned local data erased, use the in-app clear/logout controls before uninstalling.

Derived repository indexes and caches can be rebuilt from local project source and may be removed independently from project files.

## 7. Third-party services

Rel.AI can interact with third-party services that have their own terms and privacy practices, including:

- **OpenAI / ChatGPT / Secure MCP Tunnel** for the ChatGPT connection you configure;
- **GitHub** for source code, release discovery, downloads, issues, and release artifacts; and
- operating-system or browser services that you explicitly invoke through Rel.AI.

Using those services can cause information to be processed by those providers independently of Rel.AI.

## 8. Security

Rel.AI uses workspace containment, bounded data movement, credential separation, renderer isolation, scoped Git publishing, update verification, and other controls described in the project's security documentation. Rel.AI is still a trusted local development harness, not a sandbox. Repository scripts and enabled desktop actions execute with the permissions available to the Rel.AI process.

See [SECURITY.md](SECURITY.md) and [docs/SECURITY.md](docs/SECURITY.md) for reporting and technical security details.

## 9. Changes to this policy

This policy can change when Rel.AI's data flows or product features change. Material changes should be reflected in the repository and release documentation. The effective date at the top identifies the current policy version.

## 10. Contact

For privacy questions, use the project repository at <https://github.com/Kyne0328/rel-ai-chatgpt-web-harness> and avoid including secrets or private repository content in public issues.

For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of publishing vulnerability details in a normal issue.
