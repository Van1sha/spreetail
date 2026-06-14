import { Router } from 'express';
import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const DEFAULT_USD_RATE = 83.5; // Approximate INR per USD for March 2025

/**
 * GET /api/expenses/group/:groupId
 * Fetches all expenses for a group with their splits.
 * Supports optional filters: startDate, endDate, category, paidBy
 */
router.get('/group/:groupId', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { startDate, endDate, category, paidBy } = req.query;

    let query = `
      SELECT e.*, u.name AS paid_by_name
      FROM expenses e
      JOIN users u ON u.id = e.paid_by
      WHERE e.group_id = $1 AND e.is_settlement = false
    `;
    const params = [groupId];
    let paramIndex = 2;

    if (startDate) {
      query += ` AND e.expense_date >= $${paramIndex++}`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND e.expense_date <= $${paramIndex++}`;
      params.push(endDate);
    }
    if (category) {
      query += ` AND e.category = $${paramIndex++}`;
      params.push(category);
    }
    if (paidBy) {
      query += ` AND e.paid_by = $${paramIndex++}`;
      params.push(paidBy);
    }

    query += ' ORDER BY e.expense_date DESC, e.created_at DESC';

    const expensesResult = await pool.query(query, params);

    // Fetch splits for each expense in one go
    if (expensesResult.rows.length > 0) {
      const expenseIds = expensesResult.rows.map(e => e.id);
      const placeholders = expenseIds.map((_, i) => `$${i + 1}`).join(',');
      const splitsResult = await pool.query(
        `SELECT es.*, u.name AS user_name
         FROM expense_splits es
         JOIN users u ON u.id = es.user_id
         WHERE es.expense_id IN (${placeholders})`,
        expenseIds
      );

      // Group splits by expense_id for easy lookup
      const splitsByExpense = {};
      for (const split of splitsResult.rows) {
        if (!splitsByExpense[split.expense_id]) {
          splitsByExpense[split.expense_id] = [];
        }
        splitsByExpense[split.expense_id].push(split);
      }

      // Attach splits to their expenses
      for (const expense of expensesResult.rows) {
        expense.splits = splitsByExpense[expense.id] || [];
      }
    }

    res.json({ expenses: expensesResult.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/expenses/:id
 * Returns a single expense with full split details.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const expenseResult = await pool.query(
      `SELECT e.*, u.name AS paid_by_name
       FROM expenses e JOIN users u ON u.id = e.paid_by
       WHERE e.id = $1`,
      [req.params.id]
    );

    if (expenseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found.' });
    }

    const splitsResult = await pool.query(
      `SELECT es.*, u.name AS user_name
       FROM expense_splits es
       JOIN users u ON u.id = es.user_id
       WHERE es.expense_id = $1`,
      [req.params.id]
    );

    res.json({
      expense: { ...expenseResult.rows[0], splits: splitsResult.rows },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/expenses/group/:groupId
 * Creates a new expense with its splits.
 *
 * For 'equal' splits, the amount is divided evenly among participants.
 * The payer absorbs any rounding remainder (e.g., ₹1000/3 = ₹333.33, ₹333.33, ₹333.34).
 */
router.post('/group/:groupId', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { groupId } = req.params;
    const {
      description, amount, currency = 'INR', exchange_rate,
      category, expense_date, split_type, notes, splits
    } = req.body;

    // Basic validation
    if (!description || !amount || !expense_date || !split_type) {
      return res.status(400).json({ error: 'Missing required fields: description, amount, expense_date, split_type.' });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number.' });
    }

    // For USD expenses, determine the exchange rate
    const effectiveRate = currency === 'USD'
      ? (exchange_rate || DEFAULT_USD_RATE)
      : null;

    // The amount in INR for splitting purposes
    const amountInINR = currency === 'USD'
      ? parsedAmount * effectiveRate
      : parsedAmount;

    await client.query('BEGIN');

    // Insert the expense
    const expenseResult = await client.query(
      `INSERT INTO expenses (group_id, paid_by, description, amount, currency, exchange_rate,
                             category, expense_date, split_type, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [groupId, req.user.id, description.trim(), parsedAmount, currency,
       effectiveRate, category || null, expense_date, split_type, notes || null]
    );

    const expense = expenseResult.rows[0];

    // Calculate and insert splits based on the split type
    if (split_type === 'equal' && splits && splits.length > 0) {
      const participantIds = splits.map(s => s.user_id);
      const perPerson = Math.floor(amountInINR * 100 / participantIds.length) / 100;
      const remainder = Math.round((amountInINR - perPerson * participantIds.length) * 100) / 100;

      for (let i = 0; i < participantIds.length; i++) {
        // Give the remainder to the last person (usually the payer)
        const splitAmount = i === participantIds.length - 1
          ? perPerson + remainder
          : perPerson;

        await client.query(
          'INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ($1, $2, $3)',
          [expense.id, participantIds[i], splitAmount]
        );
      }
    } else if (split_type === 'exact' && splits) {
      for (const split of splits) {
        await client.query(
          'INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ($1, $2, $3)',
          [expense.id, split.user_id, parseFloat(split.amount)]
        );
      }
    } else if (split_type === 'percentage' && splits) {
      for (const split of splits) {
        const splitAmount = Math.round(amountInINR * parseFloat(split.percentage) / 100 * 100) / 100;
        await client.query(
          'INSERT INTO expense_splits (expense_id, user_id, amount, percentage) VALUES ($1, $2, $3, $4)',
          [expense.id, split.user_id, splitAmount, split.percentage]
        );
      }
    } else if (split_type === 'shares' && splits) {
      const totalShares = splits.reduce((sum, s) => sum + parseInt(s.shares || 0), 0);
      for (const split of splits) {
        const shareCount = parseInt(split.shares || 0);
        const splitAmount = totalShares > 0
          ? Math.round(amountInINR * shareCount / totalShares * 100) / 100
          : 0;
        await client.query(
          'INSERT INTO expense_splits (expense_id, user_id, amount, shares) VALUES ($1, $2, $3, $4)',
          [expense.id, split.user_id, splitAmount, shareCount]
        );
      }
    }

    await client.query('COMMIT');

    res.status(201).json({ expense });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/**
 * PUT /api/expenses/:id
 * Updates an existing expense. Replaces splits entirely.
 */
router.put('/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { description, amount, currency, exchange_rate, category, expense_date, split_type, notes, splits } = req.body;

    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE expenses SET
        description = COALESCE($1, description),
        amount = COALESCE($2, amount),
        currency = COALESCE($3, currency),
        exchange_rate = $4,
        category = COALESCE($5, category),
        expense_date = COALESCE($6, expense_date),
        split_type = COALESCE($7, split_type),
        notes = $8
       WHERE id = $9 RETURNING *`,
      [description, amount, currency, exchange_rate, category, expense_date, split_type, notes, req.params.id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Expense not found.' });
    }

    // If new splits provided, replace old ones
    if (splits && splits.length > 0) {
      await client.query('DELETE FROM expense_splits WHERE expense_id = $1', [req.params.id]);
      for (const split of splits) {
        await client.query(
          'INSERT INTO expense_splits (expense_id, user_id, amount, percentage, shares) VALUES ($1, $2, $3, $4, $5)',
          [req.params.id, split.user_id, split.amount, split.percentage || null, split.shares || null]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ expense: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/expenses/:id
 * Removes an expense and its splits (cascade handles the splits).
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM expenses WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found.' });
    }
    res.json({ message: 'Expense deleted.' });
  } catch (err) {
    next(err);
  }
});

export default router;
