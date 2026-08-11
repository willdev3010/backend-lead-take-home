import { Router } from 'express';
import { z } from 'zod';
import { positiveMoneyString } from '../lib/money-schema';
import * as depositService from '../services/deposit-service';
import { WalletNotFoundError } from '../services/deposit-service';

export const depositsRouter = Router();

const createDepositBody = z.object({
  memberId: z.string().uuid(),
  amount: positiveMoneyString,
  turnoverMultiplier: z.number().int().min(0).default(1),
});

depositsRouter.post('/', async (req, res, next) => {
  try {
    const body = createDepositBody.parse(req.body);
    const { transactionId, pspRef } = await depositService.createDeposit(body);
    res.status(201).json({ transactionId, pspRef });
  } catch (err) {
    if (err instanceof WalletNotFoundError) {
      res.status(404).json({ error: 'wallet not found' });
      return;
    }
    next(err);
  }
});
