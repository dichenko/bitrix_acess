
import { DateTime } from 'luxon';
import { env } from './env.js';

const PLATE_LETTERS = 'АВЕКМНОРСТУХ';

const LATIN_TO_CYRILLIC: Record<string, string> = {
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У'
};

export function parseMessage(msg: string): { carNumber: string; regCode: string } {
  const normalized = msg
    .toUpperCase()
    .replace(/[ABCEHKMOPTXY]/g, (letter) => LATIN_TO_CYRILLIC[letter] ?? letter);
  const letter = `[${PLATE_LETTERS}]`;
  const separator = '[^\\p{L}\\d]*';
  const match = normalized.match(new RegExp(`(${letter}${separator}\\d${separator}\\d${separator}\\d${separator}${letter}${separator}${letter}${separator}\\d{2,3})(?!\\d)`, 'u'));

  if (!match) {
    throw new Error('Введите полный российский номер с регионом, например: А123АА77. Пробелы и дефисы допустимы.');
  }

  const compact = match[1].replace(/[^\p{L}\d]/gu, '');
  return { carNumber: compact.slice(0, 6), regCode: compact.slice(6) };
}

export function formatVisitAt(s?: string): string {
  const zone = env('TZ', 'Europe/Moscow');
  const dt = s
    ? DateTime.fromFormat(s, 'dd.MM.yyyy HH:mm:ss', { zone })
    : DateTime.now().setZone(zone).plus({ minutes: 5 });
  if (!dt.isValid) throw new Error('Неверный формат visit_at, нужен DD.MM.YYYY HH:mm:ss');
  return dt.toFormat('dd.MM.yyyy HH:mm:ss');
}
