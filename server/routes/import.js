import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { analyzeCSV, confirmImport } from '../services/importService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup multer upload directory inside project workspace
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });
const router = Router();
router.use(authenticate);

/**
 * POST /api/import/group/:groupId/upload
 * Uploads a CSV, parses it, finds anomalies, and creates a batch.
 */
router.post('/group/:groupId/upload', upload.single('file'), async (req, res, next) => {
  try {
    const { groupId } = req.params;
    
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a CSV file.' });
    }

    const result = await analyzeCSV(groupId, req.file.path, req.file.originalname, req.user.id);
    
    res.status(201).json({
      message: 'CSV uploaded and analyzed successfully. Anomalies detected.',
      batchId: result.batchId,
      anomaliesFound: result.anomaliesFound
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/import/:batchId
 * Returns the batch details and its associated anomalies for review.
 */
router.get('/:batchId', async (req, res, next) => {
  try {
    const { batchId } = req.params;

    const batchRes = await pool.query(
      `SELECT ib.*, u.name AS imported_by_name 
       FROM import_batches ib
       JOIN users u ON u.id = ib.imported_by
       WHERE ib.id = $1`,
      [batchId]
    );

    if (batchRes.rows.length === 0) {
      return res.status(404).json({ error: 'Import batch not found.' });
    }

    const anomaliesRes = await pool.query(
      `SELECT * FROM import_anomalies 
       WHERE batch_id = $1 
       ORDER BY row_number ASC, id ASC`,
      [batchId]
    );

    res.json({
      batch: batchRes.rows[0],
      anomalies: anomaliesRes.rows
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/import/:batchId/anomalies/:anomalyId
 * Updates the user decision for a specific anomaly.
 */
router.put('/:batchId/anomalies/:anomalyId', async (req, res, next) => {
  try {
    const { batchId, anomalyId } = req.params;
    const { user_decision } = req.body;

    if (!user_decision) {
      return res.status(400).json({ error: 'user_decision is required.' });
    }

    const result = await pool.query(
      `UPDATE import_anomalies 
       SET user_decision = $1, resolved_at = NOW() 
       WHERE id = $2 AND batch_id = $3 
       RETURNING *`,
      [user_decision, anomalyId, batchId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Anomaly not found in this batch.' });
    }

    res.json({ anomaly: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/import/:batchId/confirm
 * Confirms the import batch, executing all transactions and splits after resolving anomalies.
 */
router.post('/:batchId/confirm', async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const { groupId } = req.body;

    if (!groupId) {
      return res.status(400).json({ error: 'groupId is required to confirm the import.' });
    }

    const result = await confirmImport(batchId, groupId);
    
    res.json({
      message: 'CSV import finalized and saved to database.',
      importedCount: result.importedCount,
      skippedCount: result.skippedCount
    });
  } catch (err) {
    next(err);
  }
});

export default router;
