import { Router } from 'express';
import { z } from 'zod';
import { positiveMoneyString } from '../lib/money-schema';
import * as pspCallbackService from '../services/psp-callback-service';

export const pspCallbacksRouter = Router();

const callbackBody = z.object({
  pspRef: z.string().min(1),
  status: z.enum(['completed', 'failed']),
  amount: positiveMoneyString,
});

pspCallbacksRouter.post('/', async (req, res, next) => {
  try {
    const body = callbackBody.parse(req.body);
    const result = await pspCallbackService.handleCallback(body);

    switch (result.outcome) {
      case 'completed':
      case 'failed':
      case 'duplicate':
        // Duplicates get the same 200 as the original: retrying PSPs only stop on 2xx.
        res.status(200).json({ ok: true });
        return;
      case 'unknown_ref':
        // Acknowledge so the PSP stops retrying a ref we will never process.
        res.status(202).json({ ok: true });
        return;
      case 'conflict':
        res.status(409).json({ error: 'conflicting_status' });
        return;
    }
  } catch (err) {
    next(err);
  }
});
