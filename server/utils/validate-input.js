/**
 * Runtime validation of tool arguments against each tool's JSON Schema.
 *
 * Why: the MCP spec expects clients to validate args against `inputSchema`,
 * but not every client does. Defense in depth — reject malformed args at the
 * server boundary before they reach Graph API calls.
 *
 * Uses Ajv because every tool already publishes a JSON Schema `inputSchema`;
 * no per-tool Zod rewrite needed.
 */

const Ajv = require('ajv');
const addFormats = require('ajv-formats');

// `strict: false` — tool schemas were hand-written, some use non-standard keywords
// (e.g. `description` on array items) that Ajv's strict mode flags. We don't want
// compile-time failure for stylistic quirks.
// `allErrors: true` — return every validation error, not just the first, so the
// LLM gets a complete picture of what's wrong with its arguments.
// `coerceTypes: 'array'` — matches handler tolerance for scalar-as-single-item-array
// (e.g. `to: "alice@x.com"` → `to: ["alice@x.com"]`). Also allows coercion of
// `"5"` → `5` for number fields. LLMs often pass loose types; this avoids
// spurious rejections for otherwise sensible inputs.
const ajv = new Ajv({ strict: false, allErrors: true, coerceTypes: 'array' });
addFormats(ajv);

/**
 * Compile validators for every tool at startup. Fails loudly if any schema is
 * invalid — better to crash now than surface a cryptic runtime error later.
 *
 * @param {Array<{ name: string, inputSchema: object }>} tools
 * @returns {Map<string, import('ajv').ValidateFunction>} validator per tool name
 */
function buildValidators(tools) {
  const validators = new Map();
  for (const tool of tools) {
    if (!tool.inputSchema) continue;
    try {
      validators.set(tool.name, ajv.compile(tool.inputSchema));
    } catch (err) {
      console.error(`[VALIDATE] Failed to compile schema for tool "${tool.name}": ${err.message}`);
      throw err;
    }
  }
  return validators;
}

/**
 * Format Ajv errors into a single human-readable string for the InvalidParams error.
 *
 * @param {import('ajv').ErrorObject[]} errors
 * @returns {string}
 */
function formatAjvErrors(errors) {
  if (!errors || errors.length === 0) return 'Unknown validation error';
  return errors
    .map(e => {
      const path = e.instancePath || '(root)';
      return `${path} ${e.message}`;
    })
    .join('; ');
}

module.exports = { buildValidators, formatAjvErrors };
