#!/bin/bash
# =============================================================================
# format.sh — проектный PostToolUse хук форматирования (delivery-tracker-v2)
#
# Заменяет глобальный format-dispatch.sh: форматирует ТОЛЬКО этим проектом,
# ТОЛЬКО локальным prettier (node_modules/.bin/prettier), пиннутой версией по
# .prettierrc.json. Глобальный prettier намеренно не используется — он бы тащил
# чужой стиль в проекты без своего конфига.
#
# Намеренно НЕ форматирует md/yaml/html: правка одной строки в доке не должна
# перевыравнивать все markdown-таблицы. Код (ts/tsx/js/css/json) форматируется.
#
# Хук НИКОГДА не блокирует Claude и всегда завершается exit 0.
# =============================================================================

set -u

stdin_data="$(cat)"
[ -z "$stdin_data" ] && exit 0

# --- Извлекаем tool_name и file_path из stdin (python3, с grep-фолбэком) ---
tool_name=""
file_path=""
if command -v python3 >/dev/null 2>&1; then
  parsed="$(printf '%s' "$stdin_data" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_name', ''))
    print(d.get('tool_input', {}).get('file_path', ''))
except Exception:
    print(''); print('')
" 2>/dev/null)" || parsed=""
  tool_name="$(printf '%s' "$parsed" | head -1)"
  file_path="$(printf '%s' "$parsed" | tail -n +2 | head -1)"
fi
if [ -z "$file_path" ]; then
  file_path="$(printf '%s' "$stdin_data" \
    | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' | head -1)" || file_path=""
fi

case "${tool_name:-}" in
  Write|Edit) ;;
  *) exit 0 ;;
esac
[ -z "$file_path" ] && exit 0
[ ! -f "$file_path" ] && exit 0

# --- Только код-расширения (md/yaml/yml/html намеренно исключены) ---
file_base="$(basename "$file_path")"
case "$file_base" in
  *.*) file_ext="${file_base##*.}" ;;
  *)   exit 0 ;;
esac
case "$file_ext" in
  js|jsx|ts|tsx|mjs|cjs|json|jsonc|css|scss) ;;
  *) exit 0 ;;
esac

# --- Только локальный prettier; нет локального — тихо выходим ---
prettier_bin="${CLAUDE_PROJECT_DIR:-.}/node_modules/.bin/prettier"
[ -x "$prettier_bin" ] || exit 0

# prettier сам уважает .prettierrc.json и .prettierignore, поднимаясь от файла.
"$prettier_bin" --write "$file_path" >/dev/null 2>&1 || true

exit 0
