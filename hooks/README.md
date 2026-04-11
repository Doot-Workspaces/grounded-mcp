# Safety Hooks for Claude Code

These hooks run automatically in Claude Code to prevent destructive commands, block credential leaks, and maintain an audit trail.

## What's Included

| Hook | Type | What it does |
|------|------|-------------|
| `pre-tool-use.sh` | PreToolUse | Blocks destructive shell commands (sudo, rm -rf, force push, git reset --hard, etc.) |
| `credential-guard.py` | PreToolUse | Scans Write/Edit/Bash calls for credential patterns and blocks them before they leak |
| `post-tool-use.sh` | PostToolUse | Logs all file writes, edits, and bash commands to a daily audit file |

## Installation

Add these to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash /path/to/grounded-mcp/hooks/pre-tool-use.sh"
          }
        ]
      },
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "python3 /path/to/grounded-mcp/hooks/credential-guard.py"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash /path/to/grounded-mcp/hooks/post-tool-use.sh"
          }
        ]
      }
    ]
  }
}
```

Replace `/path/to/grounded-mcp` with the actual path on your machine.

## Why These Matter for M365

When your AI tool can send emails, post to Teams, and access SharePoint on your behalf, safety hooks are critical:

- **Credential guard** prevents your Azure Client Secret or OAuth tokens from being written to files that might get committed to git
- **Pre-tool-use** blocks destructive commands that could wipe your project or force-push over teammates' work
- **Audit log** gives you a daily record of every action taken, useful for compliance and debugging

## Customization

Each hook file has inline comments explaining how to add your own rules. The patterns are designed to be extended — add rules for your specific stack and security requirements.
