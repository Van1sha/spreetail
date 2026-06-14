import { Router } from 'express';
import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

/**
 * GET /api/settlements/group/:groupId
 * Returns all recorded settlements in a group.
 */
router.get('/group/:groupId', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const result = await pool.query(
      `SELECT s.*, 
              u1.name AS paid_by_name, 
              u2.name AS paid_to_name
       FROM settlements s
       JOIN users u1 ON u1.id = s.paid_by
       JOIN users u2 ON u2.id = s.paid_to
       WHERE s.group_id = $1
       ORDER BY s.settlement_date DESC, s.created_at DESC`,
      [groupId]
    );
    res.json({ settlements: result.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/settlements
 * Records a new settlement between two group members.
 */
router.post('/group/:groupId', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { paid_by, paid_to, amount, settlement_date, notes } = req.body;

    if (!paid_by || !paid_to || !amount || !settlement_date) {
      return res.status(400).json({ error: 'Missing required fields: paid_by, paid_to, amount, settlement_date.' });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number.' });
    }

    // Insert the settlement record
    const result = await pool.query(
      `INSERT INTO settlements (group_id, paid_by, paid_to, amount, settlement_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [groupId, paid_by, paid_to, parsedAmount, settlement_date, notes || null]
    );

    res.status(201).json({ settlement: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/settlements/:id
 * Deletes a settlement record.
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM settlements WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Settlement record not found.' });
    }

    res.json({ message: 'Settlement record deleted successfully.' });
  } catch (err) {
    next(err);
  }
});

export default router;
