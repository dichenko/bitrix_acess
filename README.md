
# KBK Pass Bot (Vercel + Telegram, Edge Config)

Serverless‑проект: Telegram‑бот + HTTP‑эндпойнт для оформления пропуска на сайте УК (Bitrix).
Хранилище «доверенных» пользователей — **Vercel Edge Config** (чтение через SDK, запись через REST API).

## Возможности
- Бот спрашивает пароль один раз, добавляет пользователя в доверенные (Edge Config).
- Доверенный пользователь пишет: `ауди 123` или `330 киа` — бот отправляет форму в ЛК.
- Параллельно доступен REST‑эндпойнт `/api/pass` (для n8n/скриптов).

## Структура
```
api/
  pass.ts        # REST-эндпойнт
  telegram.ts    # Telegram webhook
lib/
  env.ts         # env с APP_ префиксами
  common.ts      # парсинг сообщения и дата
  bitrix.ts      # логин + отправка формы
  trust.ts       # Edge Config (get) + REST write
vercel.json      # Node.js 20 runtime
package.json
.env.example
tsconfig.json
.gitignore
```

## Настройка

1. **Edge Config (Dashboard → Storage → Create Database → Edge Config).**
   - Создай Edge Config и **привяжи к проекту**. Vercel автоматически добавит env `EDGE_CONFIG` (connection string) для чтения.
   - Открой **Settings** Edge Config и **скопируй `Edge Config ID`** → вставь в `EDGE_CONFIG_ID` (env).
2. **Access Token для REST‑записей.**
   - Создай **Vercel Access Token** в личном аккаунте (или в Team) и запиши в `VERCEL_ACCESS_TOKEN` (env).
   - Если Edge Config создан в **Team**, также укажи `TEAM_ID` (env).
3. **Заполни остальные переменные** из `.env.example` (логин/пароль ЛК, TELEGRAM_* и т.п.).
4. Задеплой проект на Vercel.
5. **Поставь вебхук Telegram:**
```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook"   -H "Content-Type: application/json"   -d "{"url":"https://<project>.vercel.app/api/telegram?secret=<TELEGRAM_WEBHOOK_SECRET>"}"
```

## Пример работы бота
1) `/start` → бот просит пароль.  
2) Отправляешь правильный пароль → бот сохраняет `trusted:<userId> = "1"` в Edge Config.  
3) Пишешь `ауди 123` → бот оформляет пропуск и отвечает статусом.

## Ручной REST‑вызов
```bash
curl -X POST https://<project>.vercel.app/api/pass   -H "X-Access-Key: <ACCESS_KEY>"   -H "Content-Type: application/json"   -d '{"text":"ауди 123"}'
```

## Примечания
- Edge Config оптимизирован под **много чтений и мало записей**; для белого списка это идеально.
- SDK `@vercel/edge-config` умеет **только читать**; запись идёт через REST `PATCH /v1/edge-config/{id}/items`.

## Голосовые сообщения
- Бот распознаёт голосовые сообщения через Yandex SpeechKit STT перед обработкой текста.
- Укажите ключ в `YANDEX_STT_API_KEY` и при необходимости `YANDEX_STT_FOLDER_ID`, язык (`YANDEX_STT_LANG`) и тему (`YANDEX_STT_TOPIC`).
- При неудачном распознавании бот ответит, что не смог распознать номер и марку машины.
