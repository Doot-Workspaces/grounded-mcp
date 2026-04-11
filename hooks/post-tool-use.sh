#!/bin/bash
# ============================================================
# PostToolUse Audit Hook -- Daily Change Log
# ============================================================
# Runs AFTER every Write, Edit, and Bash tool call.
# Logs what happened to a daily file for review.
#
# Log location: ~/.claude/logs/changes-YYYY-MM-DD.log
# Auto-rotates: deletes logs older than 30 days (once per day)
#
# Each entry looks like:
#   [14:32:07] Write -> /path/to/file.py
#   [14:32:09] Bash -> git commit -m "fix bug"
#   [14:32:11] Edit -> /path/to/config.json (new_string: 45 chars)
# ============================================================

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null)

LOG_DIR="$HOME/.claude/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/changes-$(date +%Y-%m-%d).log"
TIMESTAMP="[$(date '+%H:%M:%S')]"

if [ "$TOOL_NAME" = "Write" ]; then
  FILE_PATH=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path','unknown'))" 2>/dev/null)
  CONTENT_LEN=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('tool_input',{}).get('content','')))" 2>/dev/null)
  echo "$TIMESTAMP Write -> $FILE_PATH ($CONTENT_LEN chars)" >> "$LOG_FILE"

elif [ "$TOOL_NAME" = "Edit" ]; then
  FILE_PATH=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path','unknown'))" 2>/dev/null)
  echo "$TIMESTAMP Edit -> $FILE_PATH" >> "$LOG_FILE"

elif [ "$TOOL_NAME" = "Bash" ]; then
  COMMAND=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command','unknown'))" 2>/dev/null)
  COMMAND_SHORT=$(echo "$COMMAND" | head -c 200)
  echo "$TIMESTAMP Bash -> $COMMAND_SHORT" >> "$LOG_FILE"
fi

# Rotate logs older than 30 days (once per day)
ROTATION_MARKER="$LOG_DIR/.last-rotation"
SHOULD_ROTATE=false

if [ ! -f "$ROTATION_MARKER" ]; then
  SHOULD_ROTATE=true
else
  MARKER_DATE=$(cat "$ROTATION_MARKER" 2>/dev/null)
  TODAY=$(date +%Y-%m-%d)
  if [ "$MARKER_DATE" != "$TODAY" ]; then
    SHOULD_ROTATE=true
  fi
fi

if [ "$SHOULD_ROTATE" = true ]; then
  find "$LOG_DIR" -name "changes-*.log" -mtime +30 -delete 2>/dev/null
  date +%Y-%m-%d > "$ROTATION_MARKER"
fi

exit 0
