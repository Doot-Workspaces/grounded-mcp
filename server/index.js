#!/usr/bin/env node
/**
 * Office MCP Server - Main entry point
 * 
 * A Model Context Protocol server that provides access to
 * Microsoft 365 services through the Microsoft Graph API.
 */

// Load environment variables from .env file
// Use absolute path to ensure it loads regardless of working directory
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } = require("@modelcontextprotocol/sdk/types.js");
const config = require('./config');
const { formatRuntimeMetadataText, getRuntimeMetadata } = require('./utils/runtime-metadata');
const { buildValidators, formatAjvErrors } = require('./utils/validate-input');

// Import module tools
const { authTools } = require('./auth');
const { calendarTools } = require('./calendar');
const { emailTools } = require('./email');
const teamsTools = require('./teams');
const { notificationTools } = require('./notifications');
const { plannerTools } = require('./planner');
const { filesTools } = require('./files');
const { searchTools } = require('./search');
const { contactsTools } = require('./contacts');
const { todoTools } = require('./todo');
const { groupsTools } = require('./groups');
const { directoryTools } = require('./directory');

// Log startup information
const runtimeMetadata = getRuntimeMetadata(config);
console.error(`STARTING ${config.SERVER_NAME.toUpperCase()} MCP SERVER`);
console.error(formatRuntimeMetadataText(runtimeMetadata));
console.error(`Client ID: ${config.AUTH_CONFIG.clientId ? config.AUTH_CONFIG.clientId.substring(0, 8) + '...' : 'NOT SET'}`);
console.error(`Token path: ${config.AUTH_CONFIG.tokenStorePath}`);
console.error(`Token exists: ${require('fs').existsSync(config.AUTH_CONFIG.tokenStorePath)}`);

// Combine all tools
const TOOLS = [
  ...authTools,
  ...calendarTools,
  ...emailTools,
  ...teamsTools,
  ...notificationTools,
  ...plannerTools,
  ...filesTools,
  ...searchTools,
  ...contactsTools,
  ...todoTools,
  ...groupsTools,
  ...directoryTools
];

// Compile Ajv validators for every tool's inputSchema. Done once at startup so
// tool/call dispatch is a cheap lookup + validate; schema compile errors surface
// immediately instead of at first invocation.
const VALIDATORS = buildValidators(TOOLS);
console.error(`[VALIDATE] Compiled ${VALIDATORS.size} tool validators`);

// Create server with tools capabilities
// SDK handles initialize and ping automatically via setRequestHandler
const server = new Server(
  { name: config.SERVER_NAME, version: config.SERVER_VERSION },
  { capabilities: { tools: {} } }
);

// tools/list — return tool metadata
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error(`TOOLS LIST REQUEST — ${TOOLS.length} tools`);
  return {
    tools: TOOLS.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  };
});

// tools/call — dispatch to the matching tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  console.error(`TOOL CALL: ${name}`);

  const tool = TOOLS.find(t => t.name === name);
  if (!tool) {
    throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
  }

  // Validate args against the tool's published inputSchema before the handler
  // sees them. Keeps malformed input from reaching Graph API calls where the
  // failure would be slower and less actionable.
  const validate = VALIDATORS.get(name);
  if (validate && !validate(args)) {
    const details = formatAjvErrors(validate.errors);
    console.error(`[VALIDATE] ${name} rejected: ${details}`);
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid arguments for ${name}: ${details}`
    );
  }

  return await tool.handler(args);
});

// Graceful shutdown handlers
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.error(`[SHUTDOWN] ${signal} received, shutting down gracefully`);

  // Give pending operations time to complete
  setTimeout(() => {
    console.error('[SHUTDOWN] Exiting');
    process.exit(0);
  }, 1000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the server
if (config.TRANSPORT_TYPE === 'http') {
  // Streamable HTTP is the current MCP spec transport (SSE is deprecated as of
  // the 2025-03-26 spec revision). Stateless mode — one transport handles every
  // request, matching the original single-client SSE semantics without session
  // routing complexity.
  const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const express = require('express');
  const app = express();
  app.use(express.json());

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  server.connect(transport)
    .then(() => console.error(`${config.SERVER_NAME} connected (Streamable HTTP)`))
    .catch(error => {
      console.error(`Connection error: ${error.message}`);
      process.exit(1);
    });

  // Single endpoint handles POST (requests), GET (SSE stream for notifications),
  // and DELETE (session teardown) per the Streamable HTTP spec.
  app.all('/mcp', async (req, res) => {
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(`[HTTP] handleRequest error: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  app.listen(config.HTTP_PORT, config.HTTP_HOST, () => {
    console.error(`${config.SERVER_NAME} HTTP (Streamable) on ${config.HTTP_HOST}:${config.HTTP_PORT}/mcp`);
  });
} else {
  const transport = new StdioServerTransport();
  server.connect(transport)
    .then(() => console.error(`${config.SERVER_NAME} connected and listening`))
    .catch(error => {
      console.error(`Connection error: ${error.message}`);
      process.exit(1);
    });
}
