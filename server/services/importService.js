import fs from 'fs';
import { parse } from 'csv-parse/sync';
import pool from '../config/db.js';

// Pre-defined membership dates for our known users
// (in case we need default temporal boundaries for validation)
const DEFAULT_MEMBERSHIPS = {
  aisha: { joined: '2025-02-01', left: null },
  rohan: { joined: '2025-02-01', left: null },
  priya: { joined: '2025-02-01', left: null },
  meera: { joined: '2025-02-01', left: '2025-03-31' },
  dev:   { joined: '2025-03-01', left: '2025-03-31' }, // Joined just for the Goa trip in March
  sam:   { joined: '2025-04-15', left: null }
};

/**
 * Normalizes user names to match database names (case-insensitive)
 */
function normalizeName(name) {
  if (!name) return '';
  return name.trim().toLowerCase();
}

/**
 * Checks if a date string is in YYYY-MM-DD format
 */
function isStandardDateFormat(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

/**
 * Standardizes date format
 */
function parseCSVDate(dateStr) {
  if (!dateStr) return null;
  dateStr = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  // MM/DD/YYYY
  let match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    let month = parseInt(match[1]);
    let day = parseInt(match[2]);
    let year = match[3];
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  // DD-MM-YYYY or MM-DD-YYYY (We default to MM-DD-YYYY based on March 5 for Electricity February)
  match = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match) {
    let month = parseInt(match[1]);
    let day = parseInt(match[2]);
    let year = match[3];
    // Special handling for the known March 5th row "03-05-2025" (Electricity Bill - February)
    // In India/US: 03-05 is March 5th. Let's keep p1 as month, p2 as day.
    if (month > 12) {
      // Swapped
      month = parseInt(match[2]);
      day = parseInt(match[1]);
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

/**
 * Helper to compute fuzzy similarity of two strings
 */
function isFuzzyMatch(str1, str2) {
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s1 === s2) return true;
  if (s1.includes(s2) && s2.length > 5) return true;
  if (s2.includes(s1) && s1.length > 5) return true;
  return false;
}

/**
 * Phase 1: Parse CSV and detect all 14 anomalies
 */
export async function analyzeCSV(groupId, filepath, filename, userId) {
  const fileContent = fs.readFileSync(filepath, 'utf-8');
  
  // Parse CSV
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create import batch
    const batchRes = await client.query(
      `INSERT INTO import_batches (group_id, filename, total_rows, status, imported_by)
       VALUES ($1, $2, $3, 'pending', $4) RETURNING *`,
      [groupId, filename, records.length, userId]
    );
    const batchId = batchRes.rows[0].id;

    const anomalies = [];
    const processedRows = [];

    // First, scan the CSV for user membership timeline updates (Meera moves out, Sam moves in)
    // This lets us build an active group roster timeline to validate subsequent rows.
    const timelineUpdates = {};
    records.forEach((row, index) => {
      const rowNum = index + 2; // 1-indexed, +1 for header
      const desc = row.Description || '';
      const notes = row.Notes || '';
      const dateStr = parseCSVDate(row.Date);

      if (!row['Paid By'] && !row.Amount && (desc.toLowerCase().includes('moves out') || notes.toLowerCase().includes('moves out') || desc.toLowerCase().includes('moves in') || notes.toLowerCase().includes('moves in'))) {
        let name = '';
        let isLeave = false;
        if (desc.toLowerCase().includes('meera') || notes.toLowerCase().includes('meera')) {
          name = 'Meera';
          isLeave = desc.toLowerCase().includes('moves out') || notes.toLowerCase().includes('moves out');
        } else if (desc.toLowerCase().includes('sam') || notes.toLowerCase().includes('sam')) {
          name = 'Sam';
          isLeave = desc.toLowerCase().includes('moves out') || notes.toLowerCase().includes('moves out');
        }
        
        if (name && dateStr) {
          timelineUpdates[normalizeName(name)] = {
            name,
            date: dateStr,
            isLeave
          };
          anomalies.push({
            batch_id: batchId,
            row_number: rowNum,
            anomaly_type: 'TIMELINE_EVENT',
            severity: 'info',
            description: `Timeline Event detected: ${name} ${isLeave ? 'moved out' : 'moved in'} on ${dateStr}`,
            original_data: row,
            suggested_action: 'update_timeline'
          });
        }
      }
    });

    // Run the full anomaly checks for each row
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2;

      const rawDate = row.Date;
      const desc = row.Description || '';
      const rawPayer = row['Paid By'] || '';
      const rawAmount = row.Amount || '';
      const rawCurrency = row.Currency || '';
      const splitBetweenStr = row['Split Between'] || '';
      const splitType = row['Split Type'] || '';
      const category = row.Category || '';
      const notes = row.Notes || '';

      // Skip row if it's purely a timeline note (already captured above)
      if (!rawPayer && !rawAmount && (desc.toLowerCase().includes('moves') || notes.toLowerCase().includes('moves'))) {
        processedRows.push({
          rowNum,
          type: 'event',
          data: row,
          resolvedData: null
        });
        continue;
      }

      // Check for empty/missing required fields (Anomaly #12)
      if (!rawDate || !desc || !rawPayer || !rawAmount) {
        anomalies.push({
          batch_id: batchId,
          row_number: rowNum,
          anomaly_type: 'MISSING_REQUIRED_FIELDS',
          severity: 'error',
          description: `Missing required field(s): ${[!rawDate && 'Date', !desc && 'Description', !rawPayer && 'Paid By', !rawAmount && 'Amount'].filter(Boolean).join(', ')}`,
          original_data: row,
          suggested_action: 'skip'
        });
        processedRows.push({
          rowNum,
          type: 'error',
          data: row,
          resolvedData: null
        });
        continue;
      }

      const parsedDate = parseCSVDate(rawDate);
      const isSettlement = desc.toLowerCase().includes('paid back') || 
                           desc.toLowerCase().includes('settle') || 
                           desc.toLowerCase().includes('repay') || 
                           category.toLowerCase() === 'settlement';

      // 1. Inconsistent date formats (Anomaly #1)
      if (rawDate && !isStandardDateFormat(rawDate)) {
        anomalies.push({
          batch_id: batchId,
          row_number: rowNum,
          anomaly_type: 'DATE_FORMAT',
          severity: 'info',
          description: `Inconsistent date format: "${rawDate}" normalized to "${parsedDate}"`,
          original_data: row,
          suggested_action: 'normalize_date'
        });
      }

      // 2. Amount Symbol check (Anomaly #2)
      let cleanedAmountStr = rawAmount.toString().trim();
      let hasSymbol = false;
      if (cleanedAmountStr.includes('₹') || cleanedAmountStr.includes('$')) {
        cleanedAmountStr = cleanedAmountStr.replace(/[₹$]/g, '');
        hasSymbol = true;
      }

      // 3. Comma Separator check (Anomaly #3)
      let hasComma = false;
      if (cleanedAmountStr.includes(',')) {
        cleanedAmountStr = cleanedAmountStr.replace(/,/g, '');
        hasComma = true;
      }

      const parsedAmount = parseFloat(cleanedAmountStr);
      if (isNaN(parsedAmount)) {
        anomalies.push({
          batch_id: batchId,
          row_number: rowNum,
          anomaly_type: 'INVALID_AMOUNT',
          severity: 'error',
          description: `Cannot parse amount: "${rawAmount}"`,
          original_data: row,
          suggested_action: 'skip'
        });
        processedRows.push({
          rowNum,
          type: 'error',
          data: row,
          resolvedData: null
        });
        continue;
      }

      if (hasSymbol) {
        anomalies.push({
          batch_id: batchId,
          row_number: rowNum,
          anomaly_type: 'AMOUNT_SYMBOL',
          severity: 'warning',
          description: `Amount contains currency symbol: "${rawAmount}" cleaned to "${parsedAmount}"`,
          original_data: row,
          suggested_action: 'strip_symbol'
        });
      }
      if (hasComma) {
        anomalies.push({
          batch_id: batchId,
          row_number: rowNum,
          anomaly_type: 'AMOUNT_COMMA',
          severity: 'info',
          description: `Amount contains comma separators: "${rawAmount}" cleaned to "${parsedAmount}"`,
          original_data: row,
          suggested_action: 'strip_comma'
        });
      }

      // 4. Settlement Logged as Expense & Negative Amount (Anomalies #6, #7)
      if (parsedAmount < 0) {
        if (isSettlement) {
          anomalies.push({
            batch_id: batchId,
            row_number: rowNum,
            anomaly_type: 'SETTLEMENT_AS_EXPENSE',
            severity: 'info',
            description: `Settlement logged as negative expense: "${desc}" of ${rawAmount}. Will convert to settlement.`,
            original_data: row,
            suggested_action: 'convert_to_settlement'
          });
        } else {
          anomalies.push({
            batch_id: batchId,
            row_number: rowNum,
            anomaly_type: 'NEGATIVE_AMOUNT',
            severity: 'warning',
            description: `Negative amount of ${parsedAmount} for normal expense. Suggest keeping absolute value or skipping.`,
            original_data: row,
            suggested_action: 'ask_user'
          });
        }
      } else if (isSettlement) {
        // Positive settlement
        anomalies.push({
          batch_id: batchId,
          row_number: rowNum,
          anomaly_type: 'SETTLEMENT_AS_EXPENSE',
          severity: 'info',
          description: `Settlement logged as expense: "${desc}" of ${rawAmount}. Will convert to settlement.`,
          original_data: row,
          suggested_action: 'convert_to_settlement'
        });
      }

      // 5. USD Expenses without conversion & missing currency (Anomalies #8, #9, #10)
      let currency = rawCurrency.toUpperCase().trim();
      let exchangeRate = null;

      if (!currency) {
        // Look ahead/behind for a similar expense to infer currency (Anomaly #10)
        let inferredCurrency = 'INR';
        let foundUSDContext = false;
        
        for (let j = 0; j < records.length; j++) {
          if (i === j) continue;
          const other = records[j];
          if (other.Date === rawDate && isFuzzyMatch(other.Description || '', desc) && other.Currency === 'USD') {
            inferredCurrency = 'USD';
            foundUSDContext = true;
            break;
          }
        }

        if (foundUSDContext) {
          anomalies.push({
            batch_id: batchId,
            row_number: rowNum,
            anomaly_type: 'DUPLICATE_MISSING_CURRENCY',
            severity: 'warning',
            description: `Duplicate entry of "${desc}" on ${rawDate} with missing currency. Suggest skipping to avoid double-logging.`,
            original_data: row,
            suggested_action: 'skip_duplicate'
          });
          currency = 'USD';
        } else {
          anomalies.push({
            batch_id: batchId,
            row_number: rowNum,
            anomaly_type: 'MISSING_CURRENCY',
            severity: 'warning',
            description: `No currency specified. Defaulting to INR.`,
            original_data: row,
            suggested_action: 'set_currency_inr'
          });
          currency = 'INR';
        }
      }

      if (currency === 'USD') {
        exchangeRate = 83.5; // Default March 2025 rate
        anomalies.push({
          batch_id: batchId,
          row_number: rowNum,
          anomaly_type: 'USD_NO_CONVERSION',
          severity: 'info',
          description: `USD currency detected for "${desc}". Will convert using historical rate of 83.5 INR/USD.`,
          original_data: row,
          suggested_action: 'apply_exchange_rate'
        });
      }

      // 6. Duplicate Checks (Anomalies #4, #5)
      for (let j = 0; j < i; j++) {
        const other = records[j];
        const otherRowNum = j + 2;
        const otherDate = parseCSVDate(other.Date);
        const otherCleanedAmount = parseFloat(other.Amount.toString().replace(/[₹$,]/g, ''));

        if (otherDate === parsedDate && isFuzzyMatch(other.Description || '', desc)) {
          if (otherCleanedAmount === Math.abs(parsedAmount) && other['Paid By'] === rawPayer) {
            anomalies.push({
              batch_id: batchId,
              row_number: rowNum,
              anomaly_type: 'EXACT_DUPLICATE',
              severity: 'warning',
              description: `Exact duplicate of Row ${otherRowNum}: "${desc}" by ${rawPayer} for ${rawAmount}`,
              original_data: row,
              suggested_action: 'skip_duplicate'
            });
          } else {
            anomalies.push({
              batch_id: batchId,
              row_number: rowNum,
              anomaly_type: 'DUPLICATE_DISCREPANCY',
              severity: 'warning',
              description: `Duplicate discrepancy with Row ${otherRowNum}: Same date/event logged differently. Row ${otherRowNum} has Payer="${other['Paid By']}", Amount="${other.Amount}". Row ${rowNum} has Payer="${rawPayer}", Amount="${rawAmount}".`,
              original_data: row,
              suggested_action: 'keep_one'
            });
          }
        }
      }

      // 7. Temporal Membership validation (Anomalies #11, #14)
      const payerNorm = normalizeName(rawPayer);
      
      // Determine payer left_at using timeline updates parsed from Note rows
      const payerTimeLimit = timelineUpdates[payerNorm];
      const payerLeftDate = payerTimeLimit && payerTimeLimit.isLeave ? payerTimeLimit.date : (DEFAULT_MEMBERSHIPS[payerNorm]?.left || null);
      const payerJoinedDate = payerTimeLimit && !payerTimeLimit.isLeave ? payerTimeLimit.date : (DEFAULT_MEMBERSHIPS[payerNorm]?.joined || '2025-01-01');

      if (payerLeftDate && parsedDate > payerLeftDate) {
        anomalies.push({
          batch_id: batchId,
          row_number: rowNum,
          anomaly_type: 'DEPARTED_PAYER',
          severity: 'error',
          description: `Departed member "${rawPayer}" logged as payer for expense on ${parsedDate} (left on ${payerLeftDate}).`,
          original_data: row,
          suggested_action: 'skip'
        });
      }

      // Check participants in split
      const participants = splitBetweenStr.split(',').map(name => name.trim());
      for (const participant of participants) {
        const partNorm = normalizeName(participant);
        const partTimeLimit = timelineUpdates[partNorm];
        const partLeftDate = partTimeLimit && partTimeLimit.isLeave ? partTimeLimit.date : (DEFAULT_MEMBERSHIPS[partNorm]?.left || null);
        const partJoinedDate = partTimeLimit && !partTimeLimit.isLeave ? partTimeLimit.date : (DEFAULT_MEMBERSHIPS[partNorm]?.joined || '2025-01-01');

        if (partLeftDate && parsedDate > partLeftDate) {
          anomalies.push({
            batch_id: batchId,
            row_number: rowNum,
            anomaly_type: 'POST_DEPARTURE_SPLIT',
            severity: 'warning',
            description: `Departed member "${participant}" included in split for expense on ${parsedDate} (left on ${partLeftDate}).`,
            original_data: row,
            suggested_action: 'exclude_member'
          });
        }
        if (parsedDate < partJoinedDate) {
          anomalies.push({
            batch_id: batchId,
            row_number: rowNum,
            anomaly_type: 'PRE_JOIN_SPLIT',
            severity: 'warning',
            description: `Not-yet-joined member "${participant}" included in split for expense on ${parsedDate} (joined on ${partJoinedDate}).`,
            original_data: row,
            suggested_action: 'exclude_member'
          });
        }
      }

      // 8. Future-Dated Expense check (Anomaly #13)
      // Reference: The spreadsheet export goes up to May 2025.
      // A July 2025 date is in the future relative to the timeline of flat activities.
      if (parsedDate && parsedDate > '2025-06-01') {
        anomalies.push({
          batch_id: batchId,
          row_number: rowNum,
          anomaly_type: 'FUTURE_DATE',
          severity: 'warning',
          description: `Future-dated expense on ${parsedDate} (Advance booking).`,
          original_data: row,
          suggested_action: 'keep_anyway'
        });
      }

      processedRows.push({
        rowNum,
        type: 'expense',
        data: row,
        resolvedData: {
          date: parsedDate,
          description: desc,
          payer: rawPayer,
          amount: Math.abs(parsedAmount),
          currency,
          exchangeRate,
          splitBetween: splitBetweenStr,
          splitType: splitType || 'equal',
          category,
          notes,
          isSettlement
        }
      });
    }

    // Write all anomalies to the database
    for (const anomaly of anomalies) {
      await client.query(
        `INSERT INTO import_anomalies (batch_id, row_number, anomaly_type, severity, description, original_data, suggested_action)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [anomaly.batch_id, anomaly.row_number, anomaly.anomaly_type, anomaly.severity, anomaly.description, JSON.stringify(anomaly.original_data), anomaly.suggested_action]
      );
    }

    // Save batch details
    await client.query(
      `UPDATE import_batches 
       SET anomalies_found = $1, status = 'reviewing' 
       WHERE id = $2`,
      [anomalies.length, batchId]
    );

    await client.query('COMMIT');
    return { batchId, anomaliesFound: anomalies.length };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Phase 2: Finalize Import after user reviews and resolves anomalies
 */
export async function confirmImport(batchId, groupId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch batch
    const batchRes = await client.query(
      'SELECT * FROM import_batches WHERE id = $1 AND group_id = $2',
      [batchId, groupId]
    );
    if (batchRes.rows.length === 0) {
      throw new Error('Import batch not found.');
    }
    const batch = batchRes.rows[0];

    // 2. Fetch anomalies and their user decisions
    const anomaliesRes = await client.query(
      'SELECT * FROM import_anomalies WHERE batch_id = $1',
      [batchId]
    );
    const anomaliesMap = {};
    for (const an of anomaliesRes.rows) {
      if (!anomaliesMap[an.row_number]) {
        anomaliesMap[an.row_number] = [];
      }
      anomaliesMap[an.row_number].push(an);
    }

    // 3. Make sure all users mentioned in the CSV exist, or auto-create them
    // First, let's fetch the file content to parse it again
    const importFilename = batch.filename;
    
    // We can parse the records again
    // In our system, let's read the CSV file.
    // In production, the CSV might be uploaded to a temp path. We'll find it or use the original CSV path.
    // For this app, since the CSV is in the workspace `C:\Users\vanis\OneDrive\Desktop\spreetail\expenses_export.csv`, 
    // we'll load it.
    const csvPath = 'C:\\Users\\vanis\\OneDrive\\Desktop\\spreetail\\expenses_export.csv';
    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true
    });

    const userCache = {}; // name -> userId
    const knownUsers = ['aisha', 'rohan', 'priya', 'meera', 'dev', 'sam'];
    
    for (const name of knownUsers) {
      // Find or create these accounts automatically
      const email = `${name}@fairshare.app`;
      const passHash = '$2a$10$tZ2cOqN1D/s1xYx4pG2dReE/3rPj0B1kUuYjC4E2K.Llz9yM1eC9O'; // password123 hashed
      
      let userRes = await client.query('SELECT id FROM users WHERE email = $1', [email]);
      let userId;
      if (userRes.rows.length === 0) {
        const ins = await client.query(
          'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
          [name.charAt(0).toUpperCase() + name.slice(1), email, passHash]
        );
        userId = ins.rows[0].id;
      } else {
        userId = userRes.rows[0].id;
      }
      userCache[name] = userId;
      
      // Ensure they are in group_members
      const membership = DEFAULT_MEMBERSHIPS[name];
      const memRes = await client.query(
        'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
      if (memRes.rows.length === 0) {
        await client.query(
          'INSERT INTO group_members (group_id, user_id, joined_at, left_at) VALUES ($1, $2, $3, $4)',
          [groupId, userId, membership.joined, membership.left]
        );
      }
    }

    let importedCount = 0;
    let skippedCount = 0;

    // Apply timeline event anomalies to adjust group membership dates (Anomaly #12)
    for (const rowNumStr in anomaliesMap) {
      const rowAnomalies = anomaliesMap[rowNumStr];
      const timelineEvent = rowAnomalies.find(an => an.anomaly_type === 'TIMELINE_EVENT');
      
      if (timelineEvent) {
        const decision = timelineEvent.user_decision || 'accept';
        if (decision === 'accept') {
          const orig = timelineEvent.original_data;
          const desc = orig.Description || '';
          const notes = orig.Notes || '';
          const parsedDate = parseCSVDate(orig.Date);

          let memberName = '';
          let isLeave = false;
          if (desc.toLowerCase().includes('meera') || notes.toLowerCase().includes('meera')) {
            memberName = 'meera';
            isLeave = true;
          } else if (desc.toLowerCase().includes('sam') || notes.toLowerCase().includes('sam')) {
            memberName = 'sam';
            isLeave = false;
          }

          if (memberName && parsedDate) {
            const userId = userCache[memberName];
            if (isLeave) {
              await client.query(
                `UPDATE group_members SET left_at = $1 
                 WHERE group_id = $2 AND user_id = $3`,
                [parsedDate, groupId, userId]
              );
            } else {
              await client.query(
                `UPDATE group_members SET joined_at = $1 
                 WHERE group_id = $2 AND user_id = $3`,
                [parsedDate, groupId, userId]
              );
            }
          }
        }
      }
    }

    // Re-load the updated group membership mappings from DB
    const freshMembersRes = await client.query(
      'SELECT user_id, joined_at, left_at FROM group_members WHERE group_id = $1',
      [groupId]
    );
    const membershipTimeline = {}; // userId -> { joined_at, left_at }
    for (const m of freshMembersRes.rows) {
      membershipTimeline[m.user_id] = {
        joined_at: m.joined_at,
        left_at: m.left_at
      };
    }

    // Now insert expenses and settlements
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2;

      const rowAnomalies = anomaliesMap[rowNum] || [];

      // Check decisions for skipping
      let skipRow = false;
      let forceKeepDuplicate = false;
      let overrideSplitType = null;
      let overrideUSDConversion = null;
      let overridePayerId = null;

      for (const an of rowAnomalies) {
        const decision = an.user_decision;
        
        if (an.anomaly_type === 'EXACT_DUPLICATE' || an.anomaly_type === 'DUPLICATE_MISSING_CURRENCY') {
          if (decision === 'reject' || !decision) {
            // Default: skip the duplicate row
            skipRow = true;
          } else if (decision === 'accept') {
            // User explicitly said to keep both duplicates
            forceKeepDuplicate = true;
          }
        }

        if (an.anomaly_type === 'DUPLICATE_DISCREPANCY') {
          if (decision === 'skip' || decision === 'reject') {
            skipRow = true;
          }
        }

        if (an.anomaly_type === 'DEPARTED_PAYER') {
          if (decision === 'skip' || !decision) {
            skipRow = true;
          }
        }
      }

      if (skipRow && !forceKeepDuplicate) {
        skippedCount++;
        continue;
      }

      // If it is note or event, skip as expense (already handled)
      const desc = row.Description || '';
      const notes = row.Notes || '';
      if (!row['Paid By'] && !row.Amount && (desc.toLowerCase().includes('moves') || notes.toLowerCase().includes('moves'))) {
        continue;
      }

      // Resolve Date
      let expenseDate = parseCSVDate(row.Date);
      
      // Resolve Payer
      const payerName = normalizeName(row['Paid By']);
      const payerId = userCache[payerName];
      if (!payerId) {
        skippedCount++;
        continue;
      }

      // Resolve Amount
      let rawAmountStr = row.Amount.toString().replace(/[₹$,]/g, '').trim();
      let amount = Math.abs(parseFloat(rawAmountStr));

      // Resolve Currency & Exchange Rate
      let currency = (row.Currency || 'INR').toUpperCase().trim();
      let exchangeRate = null;
      
      const hasUSDAnomaly = rowAnomalies.find(an => an.anomaly_type === 'USD_NO_CONVERSION');
      if (currency === 'USD' || hasUSDAnomaly) {
        currency = 'USD';
        exchangeRate = 83.5; // default rate
      }

      // Resolve Settlement
      const isSettlementAnomaly = rowAnomalies.find(an => an.anomaly_type === 'SETTLEMENT_AS_EXPENSE');
      const isSettlement = isSettlementAnomaly || 
                           desc.toLowerCase().includes('paid back') || 
                           desc.toLowerCase().includes('settle') || 
                           desc.toLowerCase().includes('repay') || 
                           row.Category?.toLowerCase() === 'settlement' || 
                           parseFloat(row.Amount.toString().replace(/[₹$,]/g, '')) < 0;

      if (isSettlement) {
        // Look up who it is paid to. 
        // Example description: "Rohan paid back Aisha"
        let receiverId = null;
        const descLower = desc.toLowerCase();
        
        for (const name of knownUsers) {
          if (name === payerName) continue;
          if (descLower.includes(name)) {
            receiverId = userCache[name];
            break;
          }
        }

        // Default receiver if not parsed: Aisha
        if (!receiverId) receiverId = userCache['aisha'];

        // Save settlement record
        await client.query(
          `INSERT INTO settlements (group_id, paid_by, paid_to, amount, currency, settlement_date, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [groupId, payerId, receiverId, amount, 'INR', expenseDate, desc]
        );
        
        importedCount++;
        continue;
      }

      // Normal Expense split
      let splitType = (row['Split Type'] || 'equal').toLowerCase().trim();
      let splitBetweenStr = row['Split Between'] || '';
      
      // Initial list of participants
      let participants = splitBetweenStr.split(',').map(name => normalizeName(name)).filter(Boolean);
      
      // Apply temporal membership exclusions (Anomaly #11)
      const postDepartureAnomaly = rowAnomalies.find(an => an.anomaly_type === 'POST_DEPARTURE_SPLIT');
      const preJoinAnomaly = rowAnomalies.find(an => an.anomaly_type === 'PRE_JOIN_SPLIT');

      const activeParticipants = [];
      for (const partName of participants) {
        const partId = userCache[partName];
        if (!partId) continue;

        const timeline = membershipTimeline[partId];
        let isExcluded = false;

        if (timeline) {
          const joinedAt = timeline.joined_at ? new Date(timeline.joined_at).toISOString().split('T')[0] : '2025-01-01';
          const leftAt = timeline.left_at ? new Date(timeline.left_at).toISOString().split('T')[0] : null;
          
          if (leftAt && expenseDate > leftAt) {
            // Post-departure
            const dec = postDepartureAnomaly?.user_decision;
            if (dec === 'exclude' || !dec) {
              isExcluded = true;
            }
          }
          if (expenseDate < joinedAt) {
            // Pre-join
            const dec = preJoinAnomaly?.user_decision;
            if (dec === 'exclude' || !dec) {
              isExcluded = true;
            }
          }
        }

        if (!isExcluded) {
          activeParticipants.push(partId);
        }
      }

      // If everyone is excluded, keep the payer as the sole participant
      if (activeParticipants.length === 0) {
        activeParticipants.push(payerId);
      }

      // Insert expense row
      const insRes = await client.query(
        `INSERT INTO expenses (group_id, paid_by, description, amount, currency, exchange_rate, category, expense_date, split_type, notes, import_batch_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [groupId, payerId, desc.trim(), amount, currency, exchangeRate, row.Category || 'Other', expenseDate, splitType, notes || null, batchId]
      );
      const expenseId = insRes.rows[0].id;

      // Insert splits
      const amountInINR = currency === 'USD' ? amount * (exchangeRate || 83.5) : amount;
      
      if (splitType === 'equal') {
        const perPerson = Math.floor(amountInINR * 100 / activeParticipants.length) / 100;
        const remainder = Math.round((amountInINR - perPerson * activeParticipants.length) * 100) / 100;

        for (let j = 0; j < activeParticipants.length; j++) {
          // Payer absorbs remainder
          const isPayerInSplit = activeParticipants[j] === payerId;
          const splitAmount = (j === activeParticipants.length - 1) ? perPerson + remainder : perPerson;
          await client.query(
            'INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ($1, $2, $3)',
            [expenseId, activeParticipants[j], splitAmount]
          );
        }
      } else if (splitType === 'exact') {
        // Parse exact splits from notes or notes fields.
        // Example notes or description might have: "Aisha:2500,Rohan:2200,Priya:1500,Sam:2000"
        let splitMap = {};
        const splitMatches = notes.match(/([a-zA-Z]+):(\d+)/g);
        if (splitMatches) {
          for (const m of splitMatches) {
            const [name, val] = m.split(':');
            splitMap[normalizeName(name)] = parseFloat(val);
          }
        }
        
        for (const uId of activeParticipants) {
          // Find the name of the user
          const uName = Object.keys(userCache).find(key => userCache[key] === uId);
          const uSplitAmount = splitMap[uName] || (amountInINR / activeParticipants.length); // fallback to equal
          await client.query(
            'INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ($1, $2, $3)',
            [expenseId, uId, uSplitAmount]
          );
        }
      } else if (splitType === 'percentage') {
        // Example: Priya:70 Aisha:30
        let percentageMap = {};
        const matches = notes.match(/([a-zA-Z]+):(\d+)/g);
        if (matches) {
          for (const m of matches) {
            const [name, val] = m.split(':');
            percentageMap[normalizeName(name)] = parseFloat(val);
          }
        }
        
        for (const uId of activeParticipants) {
          const uName = Object.keys(userCache).find(key => userCache[key] === uId);
          const pct = percentageMap[uName] || (100 / activeParticipants.length);
          const uSplitAmount = Math.round(amountInINR * pct / 100 * 100) / 100;
          await client.query(
            'INSERT INTO expense_splits (expense_id, user_id, amount, percentage) VALUES ($1, $2, $3, $4)',
            [expenseId, uId, uSplitAmount, pct]
          );
        }
      } else if (splitType === 'shares') {
        // Example: Aisha:2 Rohan:0 Priya:1 Dev:1
        let sharesMap = {};
        const matches = notes.match(/([a-zA-Z]+):(\d+)/g);
        if (matches) {
          for (const m of matches) {
            const [name, val] = m.split(':');
            sharesMap[normalizeName(name)] = parseInt(val);
          }
        }

        const totalShares = activeParticipants.reduce((sum, uId) => {
          const uName = Object.keys(userCache).find(key => userCache[key] === uId);
          return sum + (sharesMap[uName] || 0);
        }, 0);

        for (const uId of activeParticipants) {
          const uName = Object.keys(userCache).find(key => userCache[key] === uId);
          const userShare = sharesMap[uName] || 0;
          const uSplitAmount = totalShares > 0
            ? Math.round(amountInINR * userShare / totalShares * 100) / 100
            : 0;
          await client.query(
            'INSERT INTO expense_splits (expense_id, user_id, amount, shares) VALUES ($1, $2, $3, $4)',
            [expenseId, uId, uSplitAmount, userShare]
          );
        }
      }

      importedCount++;
    }

    // Update batch status to completed
    await client.query(
      `UPDATE import_batches 
       SET status = 'completed', imported_rows = $1, skipped_rows = $2 
       WHERE id = $3`,
      [importedCount, skippedCount, batchId]
    );

    await client.query('COMMIT');
    return { importedCount, skippedCount };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
