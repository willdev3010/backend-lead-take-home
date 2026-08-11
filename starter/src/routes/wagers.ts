import { Router } from 'express';
import { z } from 'zod';
import { positiveMoneyString } from '../lib/money-schema';
import * as wagerService from '../services/wager-service';
import { InsufficientBalanceError, WalletNotFoundError } from '../services/wager-service';

export const wagersRouter = Router();

const wagerParams = z.object({ walletId: z.string().uuid() });
const wagerBody = z.object({ amount: positiveMoneyString });

wagersRouter.post('/:walletId/wagers', async (req, res, next) => {
  try {
    const { walletId } = wagerParams.parse(req.params);
    const { amount } = wagerBody.parse(req.body);
    const { balance } = await wagerService.placeWager({ walletId, amount });
    res.status(201).json({ balance });
  } catch (err) {
    if (err instanceof WalletNotFoundError) {
      res.status(404).json({ error: 'wallet not found' });
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
