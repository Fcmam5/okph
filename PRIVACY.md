# Privacy Policy

_Last updated: 2026-09-09_

`okph` is an open-source command-line tool and library that converts a folder of Markdown files (OKF knowledge bases) into a [Mermaid](https://mermaid.js.org/) graph. This document explains what data the project does — and does not — handle.

## TL;DR

- The tool runs **entirely on your local machine**.
- It does **not** collect, transmit, or store any personal data, telemetry, analytics, or usage statistics.
- It does **not** make outbound network requests at runtime.

## Data the tool processes

When you run `okph graph <path>`, it reads Markdown files under that path and writes a Mermaid graph definition to standard output. Document titles and links are processed **locally and in memory only**. Nothing is uploaded anywhere by this tool.

You remain solely responsible for any output you choose to publish (for example, by committing the generated Mermaid diagram to a public repository).

## Telemetry

There is **no telemetry**. The package contains no analytics SDK, crash reporter, or "phone home" mechanism. You can verify this by inspecting the source code in this repository or the published package on npm.

## Third-party services

Installing or using `okph` may indirectly involve third parties that have their own privacy policies, for example:

- **npm / GitHub** when you install or clone the package.
- **Mermaid renderers** when you choose to render the generated diagram.

These services are outside the control of this project.

## Data we collect through GitHub

If you interact with this repository on GitHub (issues, pull requests, discussions, security advisories), GitHub will process the information you provide according to [GitHub's Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). The maintainers only see what GitHub exposes to repository collaborators.

## Security reports

If you contact the maintainer privately to report a security issue (see [`SECURITY.md`](./SECURITY.md)), your email address and the contents of your report will be used solely to triage and fix the issue. Reports are not shared publicly without your consent, beyond any eventual GitHub Security Advisory acknowledgements.

## Children's privacy

The project is a developer tool and is not directed at children under 13. No personal data is knowingly collected from anyone.

## Changes to this policy

This policy may be updated as the project evolves. Material changes will be reflected in the commit history of this file and the "Last updated" date above.

## Contact

For privacy-related questions, contact: **au54vz9rk@mozmail.com**.
