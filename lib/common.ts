
import { DateTime } from 'luxon';
import { env } from './env.js';

export function parseMessage(msg: string): { carInfo: string; number3: string } {
  const m = msg.match(/\b(\d{3})\b/);
  if (!m) throw new Error('В сообщении должны быть ровно 3 цифры (например: "ауди 123" или "330 киа").');
  const number3 = m[1];
  const carInfo = msg.replace(m[0], ' ').replace(/\s+/g, ' ').trim();
  if (!carInfo) throw new Error('Не найдено название марки/описание авто (CAR_INFO).');
  return { carInfo, number3 };
}

export function formatVisitAt(s?: string): string {
  const zone = env('TZ', 'Europe/Moscow');
  const dt = s
    ? DateTime.fromFormat(s, 'dd.MM.yyyy HH:mm:ss', { zone })
    : DateTime.now().setZone(zone).plus({ minutes: 5 });
  if (!dt.isValid) throw new Error('Неверный формат visit_at, нужен DD.MM.YYYY HH:mm:ss');
  return dt.toFormat('dd.MM.yyyy HH:mm:ss');
}
