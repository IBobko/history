# Общий пользователь публикации

С 29 октября 2026 года используется `deploy@91.99.238.7` с общим ключом
немецкого сервера. Ключ хранится на Samsung_T5; точный путь записан в
Infrastructure, лист «Доступы», строка 17. Секрет `DEPLOY_SSH_KEY` подготовлен
в GitHub-репозитории `IBobko/history`.

Публикация выполняется из `main` через два workflow GitHub Actions.
Материалы хранятся в `/opt/history-archive/content/releases/<SHA>`,
активная версия выбирается ссылкой `content/current`. Эти пути контролирует root.
Изменения текста видны без пересборки приложения.

Разрешённые команды для архива:

```sh
sudo -n /usr/local/sbin/project-deploy check-history
sudo -n /usr/local/sbin/project-deploy history-restart
sudo -n /usr/local/sbin/history-deploy check
sudo -n /usr/local/sbin/history-deploy content
sudo -n /usr/local/sbin/history-deploy code
```

Первые две команды проверяют и перезапускают установленную версию. Новый
помощник проверяет сайт, публикует материалы или приложение из фиксированного
репозитория. Для `content` и `code` SHA текущего `main` передаётся через stdin.
Конфигурация находится в `/etc/project-deploy/history.compose.yml`, защищена
от записи пользователем `deploy` и закрепляет установленную версию образа.

Прямой доступ к Docker-сокету и произвольному sudo не предоставлен.
Общий ключ не разрешает вход как root или wp-deploy. Административный доступ
через YubiKey сохраняется. Старый пользователь wp-deploy удалён.

Инструкция по автоматической публикации, проверкам и откату:
[deploy/README.md](README.md). Исходники нового помощника и sudo находятся
в этой папке. Общий помощник других проектов хранится в `deploy/` репозитория
`IBobko/lex-humanitas`.
