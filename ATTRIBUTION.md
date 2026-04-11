# Attribution

## Based on

**[hvkshetry/office-365-mcp-server](https://github.com/hvkshetry/office-365-mcp-server)**  
License: MIT  
Author: hvkshetry  

Grounded MCP is a distribution of this project. The `server/` directory contains code derived from the upstream source, used and redistributed under the MIT license.

## What we added

- **Safety hooks** (`hooks/` directory): credential guard, destructive command blocker, audit log — for Claude Code integration safety
- **Outbound format discipline** (`server/utils/outbound-format.js`): sign-off injection with env-configurable OUTBOUND_SIGN_OFF, HTML formatting for email replies and Teams messages, empty sign-off guard for clean pipe mode
- **Runtime verification** (`server/utils/runtime-metadata.js`, `server/scripts/live-format-smoke-test.js`): live fingerprint tool and post-restart formatting smoke test
- **Operational security docs**: RULES.md (AI email/messaging safety), SECURITY.md (data flow, incident response), SETUP-GUIDE.md (step-by-step Azure setup)
- **OUTBOUND_SIGN_OFF env control**: centralizes sign-off behavior; empty string disables injection entirely

## License

Both the upstream project and this distribution are MIT licensed.
