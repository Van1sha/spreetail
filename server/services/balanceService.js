import pool from '../config/db.js';

/**
 * Calculates net balances for all members in a group.
 * Net balance = (total amount paid by user as payer) 
 *               + (total settlements paid by user)
 *               - (total of user's splits in expense_splits)
 *               - (total settlements received by user)
 * 
 * Returns an object mapping userId to user details and their net balance in INR.
 */
export async function getGroupBalances(groupId) {
  // 1. Get all members of the group
  const membersRes = await pool.query(
    `SELECT u.id, u.name, u.email, gm.joined_at, gm.left_at
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1`,
    [groupId]
  );
  
  const balances = {};
  for (const member of membersRes.rows) {
    balances[member.id] = {
      id: member.id,
      name: member.name,
      email: member.email,
      joined_at: member.joined_at,
      left_at: member.left_at,
      paidAmount: 0.0,      // Total fronted as payer (INR)
      splitAmount: 0.0,     // Total owed as participant (INR)
      settlementsPaid: 0.0, // Total paid to others in settlements (INR)
      settlementsReceived: 0.0, // Total received from others in settlements (INR)
      netBalance: 0.0       // paidAmount + settlementsPaid - splitAmount - settlementsReceived
    };
  }

  // 2. Fetch all expenses for this group (excluding settlements)
  // We convert USD amounts using the exchange_rate stored in the row.
  const expensesRes = await pool.query(
    `SELECT id, paid_by, amount, currency, exchange_rate, expense_date
     FROM expenses
     WHERE group_id = $1 AND is_settlement = false`,
    [groupId]
  );

  for (const expense of expensesRes.rows) {
    const rate = expense.currency === 'USD' ? parseFloat(expense.exchange_rate || 83.5) : 1.0;
    const amountInINR = parseFloat(expense.amount) * rate;

    // Credit the payer (if they are a group member)
    if (balances[expense.paid_by]) {
      balances[expense.paid_by].paidAmount += amountInINR;
    }
  }

  // 3. Fetch all splits for these expenses
  const splitsRes = await pool.query(
    `SELECT es.user_id, es.amount
     FROM expense_splits es
     JOIN expenses e ON e.id = es.expense_id
     WHERE e.group_id = $1 AND e.is_settlement = false`,
    [groupId]
  );

  for (const split of splitsRes.rows) {
    if (balances[split.user_id]) {
      balances[split.user_id].splitAmount += parseFloat(split.amount);
    }
  }

  // 4. Fetch all settlements
  const settlementsRes = await pool.query(
    `SELECT paid_by, paid_to, amount
     FROM settlements
     WHERE group_id = $1`,
    [groupId]
  );

  for (const set of settlementsRes.rows) {
    const amount = parseFloat(set.amount);
    if (balances[set.paid_by]) {
      balances[set.paid_by].settlementsPaid += amount;
    }
    if (balances[set.paid_to]) {
      balances[set.paid_to].settlementsReceived += amount;
    }
  }

  // 5. Calculate net balances
  for (const userId in balances) {
    const b = balances[userId];
    b.netBalance = Math.round((b.paidAmount + b.settlementsPaid - b.splitAmount - b.settlementsReceived) * 100) / 100;
  }

  return balances;
}

/**
 * Calculates the optimized settlement plan (Aisha's "one number" - who pays whom, how much).
 * Uses a greedy algorithm to minimize transactions.
 */
export async function getSettlementPlan(groupId) {
  const balances = await getGroupBalances(groupId);
  
  // Create arrays of debtors (net < 0) and creditors (net > 0)
  const debtors = [];
  const creditors = [];

  for (const userId in balances) {
    const b = balances[userId];
    if (b.netBalance < -0.01) {
      debtors.push({ id: b.id, name: b.name, balance: b.netBalance });
    } else if (b.netBalance > 0.01) {
      creditors.push({ id: b.id, name: b.name, balance: b.netBalance });
    }
  }

  // Sort debtors ascending (who owes the most first)
  debtors.sort((a, b) => a.balance - b.balance);
  // Sort creditors descending (who is owed the most first)
  creditors.sort((a, b) => b.balance - a.balance);

  const transactions = [];

  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];

    const oweAmount = -debtor.balance;
    const creditAmount = creditor.balance;

    const settleAmount = Math.round(Math.min(oweAmount, creditAmount) * 100) / 100;

    if (settleAmount > 0.01) {
      transactions.push({
        from: { id: debtor.id, name: debtor.name },
        to: { id: creditor.id, name: creditor.name },
        amount: settleAmount
      });
    }

    debtor.balance += settleAmount;
    creditor.balance -= settleAmount;

    if (Math.abs(debtor.balance) < 0.01) {
      dIdx++;
    }
    if (Math.abs(creditor.balance) < 0.01) {
      cIdx++;
    }
  }

  return transactions;
}

/**
 * Generates Rohan's detailed drill-down showing exactly which expenses
 * make up a user's net balance.
 */
export async function getUserBreakdown(groupId, userId) {
  // Get all expenses where the user either paid or was in the split list
  const expensesRes = await pool.query(
    `SELECT e.id, e.description, e.amount, e.currency, e.exchange_rate, 
            e.expense_date, e.category, e.paid_by, u.name AS paid_by_name,
            es.amount AS user_split_amount
     FROM expenses e
     LEFT JOIN expense_splits es ON es.expense_id = e.id AND es.user_id = $1
     JOIN users u ON u.id = e.paid_by
     WHERE e.group_id = $2 AND e.is_settlement = false AND (e.paid_by = $1 OR es.id IS NOT NULL)
     ORDER BY e.expense_date DESC`,
    [userId, groupId]
  );

  const items = [];
  let totalPaid = 0.0;
  let totalOwed = 0.0;

  for (const row of expensesRes.rows) {
    const rate = row.currency === 'USD' ? parseFloat(row.exchange_rate || 83.5) : 1.0;
    const amountInINR = parseFloat(row.amount) * rate;

    const isPayer = row.paid_by === parseInt(userId);
    const userSplit = row.user_split_amount ? parseFloat(row.user_split_amount) : 0.0;
    
    // Net effect of this expense on the user's balance:
    // If they paid: they get credited the full amount, but they also owe their split.
    // So net effect = (isPayer ? amountInINR : 0) - userSplit
    const netEffect = (isPayer ? amountInINR : 0) - userSplit;

    if (isPayer) totalPaid += amountInINR;
    totalOwed += userSplit;

    items.push({
      expenseId: row.id,
      description: row.description,
      category: row.category,
      date: row.expense_date,
      originalAmount: parseFloat(row.amount),
      currency: row.currency,
      amountInINR: amountInINR,
      paidBy: { id: row.paid_by, name: row.paid_by_name },
      isPayer,
      userSplit,
      netEffect: Math.round(netEffect * 100) / 100
    });
  }

  // Add settlements
  const settlementsRes = await pool.query(
    `SELECT s.id, s.amount, s.settlement_date, s.notes,
            s.paid_by, u1.name AS paid_by_name,
            s.paid_to, u2.name AS paid_to_name
     FROM settlements s
     JOIN users u1 ON u1.id = s.paid_by
     JOIN users u2 ON u2.id = s.paid_to
     WHERE s.group_id = $1 AND (s.paid_by = $2 OR s.paid_to = $2)
     ORDER BY s.settlement_date DESC`,
    [groupId, userId]
  );

  const settlements = [];
  let totalSettlementsPaid = 0.0;
  let totalSettlementsReceived = 0.0;

  for (const s of settlementsRes.rows) {
    const amount = parseFloat(s.amount);
    const isPayer = s.paid_by === parseInt(userId);
    
    if (isPayer) {
      totalSettlementsPaid += amount;
    } else {
      totalSettlementsReceived += amount;
    }

    settlements.push({
      settlementId: s.id,
      date: s.settlement_date,
      amount,
      notes: s.notes,
      paidBy: { id: s.paid_by, name: s.paid_by_name },
      paidTo: { id: s.paid_to, name: s.paid_to_name },
      isPayer,
      netEffect: isPayer ? amount : -amount
    });
  }

  const finalNet = Math.round((totalPaid + totalSettlementsPaid - totalOwed - totalSettlementsReceived) * 100) / 100;

  return {
    userId: parseInt(userId),
    summary: {
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalOwed: Math.round(totalOwed * 100) / 100,
      totalSettlementsPaid: Math.round(totalSettlementsPaid * 100) / 100,
      totalSettlementsReceived: Math.round(totalSettlementsReceived * 100) / 100,
      netBalance: finalNet
    },
    expenses: items,
    settlements
  };
}
