
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { env } from '../lib/env.js';
import { parseMessage, formatVisitAt } from '../lib/common.js';
import { submitPass } from '../lib/bitrix.js';
import { notifyAdminPassOrder } from '../lib/adminNotifications.js';

const ACCESS_KEY = env('ACCESS_KEY');

const bodySchema = z.object({
  text: z.string().min(2),
  visit_at: z.string().regex(/^\d{2}\.\d{2}\.\d{4}\s\d{2}:\d{2}:\d{2}$/).optional(),
  comment: z.string().optional()
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  let parsedOrder:
    | {
        carNumber: string;
        regCode: string;
        visit: string;
      }
    | undefined;

  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    if (req.headers['x-access-key'] !== ACCESS_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const { text, visit_at, comment } = parsed.data;
    const { carNumber, regCode } = parseMessage(text);
    const visit = formatVisitAt(visit_at);
    parsedOrder = { carNumber, regCode, visit };

    const result = await submitPass({
      carNumber,
      regCode,
      visitAt: visit,
      comment
    });

    await notifyAdminPassOrder({
      source: 'REST API',
      carNumber,
      regCode,
      visit,
      ok: result.ok,
      error: result.ok ? undefined : `HTTP ${result.status}: ${result.snippet}`
    });

    return res.status(result.ok ? 200 : 502).json({
      ok: result.ok,
      httpStatus: result.status,
      sent: result.sent,
      rawSnippet: result.snippet
    });

  } catch (err: any) {
    const msg = err?.message || 'Unknown error';
    if (parsedOrder) {
      await notifyAdminPassOrder({
        source: 'REST API',
        ...parsedOrder,
        ok: false,
        error: msg
      });
    }
    const isTimeout = /timeout|ECONN|ETIMEDOUT/i.test(msg);
    return res.status(isTimeout ? 504 : 502).json({ ok: false, error: msg });
  }
}
