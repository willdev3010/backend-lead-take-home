import { Router } from 'express';
import { z } from 'zod';
import { positiveMoneyString } from '../lib/money-schema';
import * as withdrawalService from '../services/withdrawal-service';
import {
  InsufficientBalanceError,
  TurnoverNotMetError,
  WalletNotFoundError,
} from '../services/withdrawal-service';

export const withdrawalsRouter = Router();

const createWithdrawalBody = z.object({
  memberId: z.string().uuid(),
  amount: positiveMoneyString,
});

withdrawalsRouter.post('/', async (req, res, next) => {
  try {
    const body = createWithdrawalBody.parse(req.body);
    const { transactionId, balance } = await withdrawalService.requestWithdrawal(body);
    res.status(201).json({ transactionId, balance });
  } catch (err) {
    if (err instanceof WalletNotFoundError) {
      res.status(404).json({ error: 'wallet not found' });
      return;
    }
    if (err instanceof TurnoverNotMetError) {
      res.status(422).json({
        error: 'turnover_not_met',
        requiredTurnover: err.requiredTurnover,
        accruedTurnover: err.accruedTurnover,
        outstanding: err.outstanding,
      });
      return;
    }
    if (err instanceof InsufficientBalanceError) {
      res.status(422).json({
        error: 'insufficient_balance',
        balance: err.balance,
        requested: err.requested,
      });
      return;
    }
    next(err);
  }
});
