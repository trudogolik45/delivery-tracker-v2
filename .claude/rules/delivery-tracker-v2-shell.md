# delivery-tracker — shell

## Не-интерактивные shell-команды

Алиасы вида `alias rm='rm -i'` / `cp='cp -i'` встречаются на dev-машинах и заставляют агент висеть на y/n. ВСЕГДА используй явные форсирующие флаги.

| Стандартное | Использовать |
|---|---|
| `cp source dest` | `cp -f source dest` |
| `mv source dest` | `mv -f source dest` |
| `rm file` | `rm -f file` |
| `cp -r source dest` | `cp -rf source dest` |
| `rm -r directory` | `rm -rf directory` |

## Команды, которые могут запросить ввод

| Команда | Не-интерактивный режим |
|---|---|
| `scp` | `-o BatchMode=yes` |
| `ssh` | `-o BatchMode=yes` (fail вместо prompt) |
| `apt-get` | `-y` |
| `brew` | `HOMEBREW_NO_AUTO_UPDATE=1` env var |
