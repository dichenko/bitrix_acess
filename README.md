# KBK Pass Bot Backend (Vercel)

Серверless‑эндпойнт для автоматической отправки формы пропуска на сайте УК.

## Что делает
- Принимает короткую фразу вида: `ауди 123` или `330 киа`.
- Берёт **ровно три цифры** → `CAR_NUMBER_RUS_NUMBER`, остальной текст → `CAR_INFO`.
- Логинится на сайт, извлекает `sessid`, отправляет форму с фиксированными полями из `.env`.
- Возвращает JSON со статусом и сжатыми данными ответа.

## Быстрый старт

1. Склонируй репозиторий и залей в свой приватный GitHub.
2. На Vercel: **New Project → Import** из GitHub.
3. Заполни **Environment Variables** по образцу из `.env.example`.
4. Deploy. Эндпойнт: `https://<project>.vercel.app/api/pass`.

### Пример запроса
```bash
curl -X POST https://<project>.vercel.app/api/pass   -H "X-Access-Key: <ACCESS_KEY>"   -H "Content-Type: application/json"   -d '{"text":"ауди 123"}'
```

### Формат тела
```json
{
  "text": "ауди 123",
  "reg_code": "000",                   // опционально, 3 цифры; по умолчанию из .env
  "visit_at": "11.10.2025 14:13:00",   // опционально; иначе now+5мин в TZ
  "comment": ""                        // опционально
}
```

## Переменные окружения
Смотри `.env.example`. Ключевые:
- `ACCESS_KEY` — секрет доступа к эндпойнту.
- `LOGIN_USER`, `LOGIN_PASSWORD` — учётка ЛК.
- `SELECT_HOUSE`, `SELECT_FLAT`, `FIO`, `PHONE` — постоянные поля формы.
- `DEFAULT_RUS_CODE` — регион по умолчанию для номера.

## Зависимости
- axios, tough-cookie, axios-cookiejar-support
- cheerio
- luxon
- zod
- qs

## Примечания
- Если сайт поменяет вёрстку и `sessid` не найдётся — вернётся ошибка 502 с подсказкой.
- Если УК включит CAPTCHA/2FA — понадобится сценарий с headless‑браузером (не входит в этот минимальный проект).
