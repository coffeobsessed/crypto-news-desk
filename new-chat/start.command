#!/bin/zsh
cd "$(dirname "$0")"
NODE="/Users/pepe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

if [ ! -x "$NODE" ]; then
  echo "Node.js не найден. Откройте проект в Codex и попросите: 'запусти приложение'."
  read -n 1 -s "?Нажмите любую клавишу, чтобы закрыть окно..."
  exit 1
fi

echo "Запускаю генератор криптоновостей..."
echo ""
echo "Когда увидите адрес http://127.0.0.1:4173, откройте его в браузере."
echo "Чтобы остановить генератор, закройте это окно."
echo ""

"$NODE" server.mjs
