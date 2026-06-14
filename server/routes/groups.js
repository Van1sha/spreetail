import { Router } from 'express';
import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Every route here needs a logged-in user
router.use(authenticate);

/**
 * GET /api/groups
 * Lists all groups the current user belongs to (past or present).
 */
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT g.*, 
              COUNT(DISTINCT gm.user_id) AS member_count,
              (SELECT COUNT(*) FROM expenses e WHERE e.group_id = g.id AND e.is_settlement = false) AS expense_count
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE g.id IN (SELECT group_id FROM group_members WHERE user_id = $1)
       GROUP BY g.id
       ORDER BY g.created_at DESC`,
      [req.user.id]
    );
    res.json({ groups: result.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/groups
 * Creates a new group and automatically adds the creator as a member.
 */
router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required.' });
    }

    await client.query('BEGIN');

    const groupResult = await client.query(
      'INSERT INTO groups (name, description, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), description || null, req.user.id]
    );
    const group = groupResult.rows[0];

    // Add creator as member starting today
    await client.query(
      'INSERT INTO group_members (group_id, user_id, joined_at) VALUES ($1, $2, CURRENT_DATE)',
      [group.id, req.user.id]
    );

    await client.query('COMMIT');
    res.status(201).json({ group });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/**
 * GET /api/groups/:id
 * Returns group details along with its member list.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const groupResult = await pool.query('SELECT * FROM groups WHERE id = $1', [req.params.id]);

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const membersResult = await pool.query(
      `SELECT gm.id AS membership_id, gm.joined_at, gm.left_at,
              u.id AS user_id, u.name, u.email
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at`,
      [req.params.id]
    );

    res.json({
      group: groupResult.rows[0],
      members: membersResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/groups/:id
 * Updates a group's name and/or description.
 */
router.put('/:id', async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const result = await pool.query(
      'UPDATE groups SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3 RETURNING *',
      [name, description, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    res.json({ group: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/groups/:id
 * Only the group creator can delete a group.
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const group = await pool.query('SELECT created_by FROM groups WHERE id = $1', [req.params.id]);

    if (group.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found.' });
    }
    if (group.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ error: 'Only the group creator can delete it.' });
    }

    await pool.query('DELETE FROM groups WHERE id = $1', [req.params.id]);
    res.json({ message: 'Group deleted.' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/groups/:id/members
 * Lists all members (current and past) with their join/leave dates.
 */
router.get('/:id/members', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT gm.id AS membership_id, gm.joined_at, gm.left_at,
              u.id AS user_id, u.name, u.email,
              CASE WHEN gm.left_at IS NULL THEN true ELSE false END AS is_active
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at`,
      [req.params.id]
    );
    res.json({ members: result.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/groups/:id/members
 * Adds a member to the group. Accepts either user_id or email.
 * joined_at defaults to today if not provided.
 */
router.post('/:id/members', async (req, res, next) => {
  try {
    let { user_id, email, joined_at } = req.body;

    // If email provided instead of user_id, look up the user
    if (!user_id && email) {
      const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'No user found with that email.' });
      }
      user_id = userResult.rows[0].id;
    }

    if (!user_id) {
      return res.status(400).json({ error: 'user_id or email is required.' });
    }

    // Check if they're already an active member
    const existing = await pool.query(
      'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2 AND left_at IS NULL',
      [req.params.id, user_id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'This person is already an active member.' });
    }

    const result = await pool.query(
      'INSERT INTO group_members (group_id, user_id, joined_at) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, user_id, joined_at || new Date().toISOString().split('T')[0]]
    );

    res.status(201).json({ member: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/groups/:id/members/:memberId
 * Updates a member's record — primarily used to set left_at when someone moves out.
 */
router.put('/:id/members/:memberId', async (req, res, next) => {
  try {
    const { left_at } = req.body;

    const result = await pool.query(
      'UPDATE group_members SET left_at = $1 WHERE id = $2 AND group_id = $3 RETURNING *',
      [left_at, req.params.memberId, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found in this group.' });
    }

    res.json({ member: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
