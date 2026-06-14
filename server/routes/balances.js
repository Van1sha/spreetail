import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getGroupBalances, getSettlementPlan, getUserBreakdown } from '../services/balanceService.js';

const router = Router();
router.use(authenticate);

/**
 * GET /api/balances/group/:groupId
 * Returns the net balances for all members of the group.
 */
router.get('/group/:groupId', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const balances = await getGroupBalances(groupId);
    res.json({ balances: Object.values(balances) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/balances/group/:groupId/settlement-plan
 * Returns the optimized transactions required to settle the group balances.
 */
router.get('/group/:groupId/settlement-plan', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const plan = await getSettlementPlan(groupId);
    res.json({ plan });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/balances/group/:groupId/user/:userId
 * Returns Rohan's detailed drill-down of all expenses/settlements contributing to a user's balance.
 */
router.get('/group/:groupId/user/:userId', async (req, res, next) => {
  try {
    const { groupId, userId } = req.params;
    const breakdown = await getUserBreakdown(groupId, userId);
    res.json({ breakdown });
  } catch (err) {
    next(err);
  }
});

export default router;
