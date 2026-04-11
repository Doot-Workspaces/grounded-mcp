# Grounded MCP — Server

This directory contains the MCP server. For full documentation, see the [root README](../README.md).

## Quick commands

```bash
npm install          # Install dependencies
npm start            # Start the MCP server (stdio mode)
npm test             # Run test suite
npm run runtime:info # Print live runtime fingerprint
npm run auth-server  # Start OAuth authentication server (browser flow)
```

## Credentials

Configure `server/.env` (copy from `.env.example`). File must have `chmod 600`.

See [SETUP-GUIDE.md](../SETUP-GUIDE.md) for the full Azure app registration walkthrough.
