#!/usr/bin/env python3
"""Credential Guard -- PreToolUse Hook

Scans every Write, Edit, and Bash tool call for credential patterns
and blocks them before they can be written to files, echoed to stdout,
or included in commands.

This prevents:
- API keys being written to memory files or committed to git
- Tokens being included in curl commands visible in logs
- Passwords being echoed or redirected to files
- Credentials leaking into any file that isn't .env
- Private keys being written to non-standard locations

HOW IT WORKS:
1. Claude Code sends JSON to stdin with tool_name and tool_input
2. We extract the content being written/executed
3. We check it against known credential patterns
4. If a match is found, we return a deny decision via JSON
5. Claude sees the denial and must find another approach

EXIT BEHAVIOR:
- Exit 0 with JSON stdout = structured deny (Claude sees the reason)
- Exit 0 with no output = allow the action
- Exit 2 would also block but ignores JSON -- we use exit 0 + JSON instead

TO ADD PATTERNS:
Add regex patterns to the CREDENTIAL_PATTERNS list below.
Each pattern should match a specific credential format.

TO ADD ALLOWED PATHS:
Add filename suffixes to the ALLOWED_PATHS list.
Files matching these paths are exempt from scanning.
"""

import sys
import json
import re

# ============================================================
# Credential patterns to detect
# Add your own patterns here for services you use.
# ============================================================
CREDENTIAL_PATTERNS = [
    # GitHub tokens
    (r'ghp_[A-Za-z0-9]{36,}',           'GitHub Personal Access Token'),
    (r'gho_[A-Za-z0-9]{36,}',           'GitHub OAuth token'),
    (r'github_pat_[A-Za-z0-9_]{82,}',   'GitHub fine-grained PAT'),
    (r'ghs_[A-Za-z0-9]{36,}',           'GitHub App installation token'),
    (r'ghr_[A-Za-z0-9]{36,}',           'GitHub refresh token'),

    # AI service keys
    (r'sk-[A-Za-z0-9]{32,}',            'OpenAI API key'),
    (r'sk-ant-[A-Za-z0-9\-]{20,}',      'Anthropic API key'),

    # Cloud provider keys
    (r'AKIA[0-9A-Z]{16}',               'AWS Access Key ID'),
    (r'ASIA[0-9A-Z]{16}',               'AWS temporary Access Key ID'),

    # Azure / Microsoft
    (r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',  None),  # UUID -- checked separately below
    (r'[A-Za-z0-9~._\-]{30,}',          None),  # Azure client secret pattern -- checked separately

    # Slack tokens
    (r'xox[bprs]-[A-Za-z0-9\-]+',       'Slack token'),

    # Generic auth patterns
    (r'Bearer\s+[A-Za-z0-9\-_.]{20,}',  'Bearer token'),
    (r'api_secret\s*[=:]\s*\S{8,}',     'api_secret assignment'),
    (r'api_key\s*[=:]\s*["\']?\S{15,}', 'api_key assignment'),
    (r'password\s*[=:]\s*["\']?\S{8,}',  'password assignment (8+ chars)'),

    # Private keys
    (r'-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----', 'Private key'),
    (r'-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----', 'SSH private key'),

    # Google Cloud
    (r'"type"\s*:\s*"service_account"',  'Google Cloud service account key'),

    # Stripe
    (r'sk_live_[A-Za-z0-9]{24,}',       'Stripe live secret key'),
    (r'rk_live_[A-Za-z0-9]{24,}',       'Stripe restricted key'),

    # SendGrid
    (r'SG\.[A-Za-z0-9\-_]{22}\.[A-Za-z0-9\-_]{43}', 'SendGrid API key'),

    # Twilio
    (r'SK[0-9a-fA-F]{32}',              'Twilio API key'),
]

# Only flag UUIDs and long strings when they appear in credential-like context
CONTEXT_PATTERNS = [
    (r'(CLIENT_ID|CLIENT_SECRET|TENANT_ID|client_id|client_secret|tenant_id)\s*[=:]\s*\S{8,}',
     'Azure/OAuth credential assignment'),
    (r'(OFFICE_CLIENT_SECRET|AZURE_CLIENT_SECRET)\s*[=:]\s*\S{8,}',
     'Azure client secret'),
]

# Tools to inspect and which field contains the content
TOOLS_TO_CHECK = {
    'Bash': ['command'],
    'Write': ['content'],
    'Edit': ['new_string', 'old_string'],
}

# ============================================================
# Paths where credentials ARE allowed
# These are the safe places for credentials to live.
# ============================================================
ALLOWED_PATHS = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.staging',
    '.env.production',
    '.env.test',
    'tests/.env',
    '.env.example',    # Usually contains placeholders, not real creds
]

# Paths where we allow credential references but warn
WARN_BUT_ALLOW_PATHS = [
    'CLAUDE.md',
    '.claude/settings.json',
    '.claude/settings.local.json',
]

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool_name = data.get('tool_name', '')
tool_input = data.get('tool_input', {})

if tool_name not in TOOLS_TO_CHECK:
    sys.exit(0)

# For Write/Edit, check if the target path is in the allowed list
if tool_name in ('Write', 'Edit'):
    file_path = tool_input.get('file_path', '')

    for allowed in ALLOWED_PATHS:
        if file_path.endswith(allowed):
            sys.exit(0)

    for warn_path in WARN_BUT_ALLOW_PATHS:
        if file_path.endswith(warn_path):
            sys.exit(0)

# Get all content fields to inspect
fields = TOOLS_TO_CHECK[tool_name]
contents_to_check = []
for field in fields:
    content = tool_input.get(field, '')
    if content:
        contents_to_check.append((field, content))

if not contents_to_check:
    sys.exit(0)

# Check for credential patterns
all_patterns = [(p, d) for p, d in CREDENTIAL_PATTERNS if d is not None] + CONTEXT_PATTERNS

for field, content in contents_to_check:
    for pattern, description in all_patterns:
        match = re.search(pattern, content)
        if match:
            matched_text = match.group(0)
            if len(matched_text) > 12:
                redacted = matched_text[:6] + '...' + matched_text[-3:]
            elif len(matched_text) > 6:
                redacted = matched_text[:4] + '***'
            else:
                redacted = '***'

            result = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"CREDENTIAL GUARD: Blocked -- detected {description} "
                        f"({redacted}) in {tool_name}.{field}. "
                        f"Credentials must NEVER be written to memory files, "
                        f"echoed in commands, or stored in code. "
                        f"Store them only in .env files (chmod 600). "
                        f"Reference their location in CLAUDE.md instead of "
                        f"storing the actual values."
                    )
                }
            }
            print(json.dumps(result))
            sys.exit(0)

sys.exit(0)
