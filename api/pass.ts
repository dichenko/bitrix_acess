
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { env } from '../lib/env.js';
import { parseMessage, formatVisitAt } from '../lib/common.js';
import { submitPass } from '../lib/bitrix.js';

const ACCESS_KEY = env('ACCESS_KEY');

const bodySchema = z.object({
  text: z.string().min(2),
  reg_code: z.string().regex(/^\d{3}$/).optional(),
  visit_at: z.string().regex(/^\d{2}\.\d{2}\.\d{4}\s\d{2}:\d{2}:\d{2}$/).optional(),
  comment: z.string().optional()
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    if (req.headers['x-access-key'] !== ACCESS_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const { text, reg_code, visit_at, comment } = parsed.data;
    const { carInfo, number3 } = parseMessage(text);
    const visit = formatVisitAt(visit_at);

    const result = await submitPass({
      carInfo,
      number3,
      regCode: reg_code,
      visitAt: visit,
      comment
    });

    return res.status(result.ok ? 200 : 502).json({
      ok: result.ok,
      httpStatus: result.status,
      sent: result.sent,
      rawSnippet: result.snippet
    });

  } catch (err: any) {
    const msg = err?.message || 'Unknown error';
    const isTimeout = /timeout|ECONN|ETIMEDOUT/i.test(msg);
    return res.status(isTimeout ? 504 : 502).json({ ok: false, error: msg });
  }
}
