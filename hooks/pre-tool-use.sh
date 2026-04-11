#!/bin/bash
# ============================================================
# PreToolUse Safety Hook -- Blocks Destructive Commands
# ============================================================
# This hook runs BEFORE every Bash tool call. If it exits with
# code 2, the command is blocked and Claude sees the error message.
#
# How it works:
# - Claude Code sends JSON to stdin with tool_name and tool_input
# - We extract the command and check it against blocked patterns
# - Exit 0 = allow, Exit 2 = block (stderr shown to Claude)
#
# To add your own rules:
# Copy any BLOCK section below and change the grep pattern
# and error message. Keep the exit 2 at the end.
# ============================================================

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null)

if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null)

# Normalize: lowercase for case-insensitive matching
CMD_LOWER=$(echo "$COMMAND" | tr '[:upper:]' '[:lower:]')

# ── BLOCK 1: sudo ──
if echo "$CMD_LOWER" | grep -qE '(^|[;&|]\s*)sudo\s'; then
  echo "BLOCKED: sudo commands require explicit permission from the user." >&2
  exit 2
fi

# ── BLOCK 2: Destructive rm ──
if echo "$CMD_LOWER" | grep -qE 'rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(/|~|\$home|\$\{home\}|\.\./)'; then
  echo "BLOCKED: recursive force-delete on root/home/parent directory is too destructive." >&2
  exit 2
fi
if echo "$CMD_LOWER" | grep -qE 'rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+/(\*|usr|etc|var|system|applications|library)'; then
  echo "BLOCKED: recursive force-delete on system directories is too destructive." >&2
  exit 2
fi

# ── BLOCK 3: git force push ──
if echo "$CMD_LOWER" | grep -qE 'git\s+push\s+.*(-f|--force|--force-with-lease)'; then
  echo "BLOCKED: force push requires explicit permission from the user." >&2
  exit 2
fi

# ── BLOCK 4: git push to main/master ──
if echo "$CMD_LOWER" | grep -qE 'git\s+push\s+\S+\s+(main|master)(\s|$|:)'; then
  echo "BLOCKED: push to main/master requires explicit permission from the user." >&2
  exit 2
fi

# ── BLOCK 5: git reset --hard ──
if echo "$CMD_LOWER" | grep -qE 'git\s+reset\s+--hard'; then
  echo "BLOCKED: git reset --hard requires explicit permission from the user." >&2
  exit 2
fi

# ── BLOCK 6: git clean ──
if echo "$CMD_LOWER" | grep -qE 'git\s+clean\s+(-[a-z]*f|-[a-z]*d)'; then
  echo "BLOCKED: git clean destroys untracked files permanently. Requires explicit permission." >&2
  exit 2
fi

# ── BLOCK 7: git checkout/restore that discards all changes ──
if echo "$CMD_LOWER" | grep -qE 'git\s+checkout\s+(--\s+)?\.(\s|$)'; then
  echo "BLOCKED: git checkout . discards all uncommitted changes. Requires explicit permission." >&2
  exit 2
fi
if echo "$CMD_LOWER" | grep -qE 'git\s+restore\s+\.(\s|$)'; then
  echo "BLOCKED: git restore . discards all uncommitted changes. Requires explicit permission." >&2
  exit 2
fi

# ── BLOCK 8: Database drops ──
if echo "$CMD_LOWER" | grep -qE 'drop\s+(database|table|schema)'; then
  echo "BLOCKED: DROP DATABASE/TABLE/SCHEMA requires explicit permission from the user." >&2
  exit 2
fi
if echo "$CMD_LOWER" | grep -qE 'truncate\s+table'; then
  echo "BLOCKED: TRUNCATE TABLE requires explicit permission from the user." >&2
  exit 2
fi

# ── BLOCK 9: Credential exfiltration ──
HAS_CRED=false
if echo "$COMMAND" | grep -qE '(ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|xox[bprs]-[A-Za-z0-9-]+|Bearer\s+[A-Za-z0-9_.=-]{20,})'; then
  HAS_CRED=true
fi

HAS_EXFIL=false
if echo "$CMD_LOWER" | grep -qE '(curl\s|wget\s|nc\s|ncat\s|netcat\s)'; then
  HAS_EXFIL=true
fi

if [ "$HAS_CRED" = true ] && [ "$HAS_EXFIL" = true ]; then
  echo "BLOCKED: potential credential exfiltration detected." >&2
  exit 2
fi

# ── BLOCK 10: Pipe-to-shell ──
if echo "$CMD_LOWER" | grep -qE '(curl|wget)\s.*\|\s*(sh|bash|zsh|python|python3|node)\b'; then
  echo "BLOCKED: piping remote content to a shell interpreter is dangerous. Download first, review, then execute." >&2
  exit 2
fi

# ── BLOCK 11: chmod 777 ──
if echo "$CMD_LOWER" | grep -qE 'chmod\s+(777|a\+rwx)'; then
  echo "BLOCKED: chmod 777/a+rwx is too permissive. Use specific permissions." >&2
  exit 2
fi

# ── BLOCK 12: Kill system processes ──
if echo "$CMD_LOWER" | grep -qE '(kill\s+-9\s+1$|killall\s+(finder|dock|systemuiserver|loginwindow|launchd|init))'; then
  echo "BLOCKED: killing system processes requires explicit permission from the user." >&2
  exit 2
fi

exit 0
