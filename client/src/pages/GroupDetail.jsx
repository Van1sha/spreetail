import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function GroupDetail() {
  const { groupId } = useParams();
  const { user } = useAuth();
  
  const [activeTab, setActiveTab] = useState('expenses');
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [balances, setBalances] = useState([]);
  const [settlementPlan, setSettlementPlan] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters for Expense List
  const [filterCategory, setFilterCategory] = useState('');
  const [filterPaidBy, setFilterPaidBy] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Modals state
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [showSettleModal, setShowSettleModal] = useState(false);
  
  // Drill-down breakdown state (Rohan's Request)
  const [selectedUserBreakdown, setSelectedUserBreakdown] = useState(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  // New Expense form state
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expCurrency, setExpCurrency] = useState('INR');
  const [expExRate, setExpExRate] = useState('83.50');
  const [expCategory, setExpCategory] = useState('Food');
  const [expDate, setExpDate] = useState(new Date().toISOString().split('T')[0]);
  const [expSplitType, setExpSplitType] = useState('equal');
  const [selectedSplits, setSelectedSplits] = useState({}); // userId -> splitValue (amount, percentage, shares)
  const [expenseError, setExpenseError] = useState('');
  const [expenseSubmitting, setExpenseSubmitting] = useState(false);

  // New Member form state
  const [memberEmail, setMemberEmail] = useState('');
  const [memberJoinDate, setMemberJoinDate] = useState(new Date().toISOString().split('T')[0]);
  const [memberError, setMemberError] = useState('');
  const [memberSubmitting, setMemberSubmitting] = useState(false);

  // Record Settlement form state
  const [settlePayer, setSettlePayer] = useState('');
  const [settleReceiver, setSettleReceiver] = useState('');
  const [settleAmount, setSettleAmount] = useState('');
  const [settleDate, setSettleDate] = useState(new Date().toISOString().split('T')[0]);
  const [settleNotes, setSettleNotes] = useState('');
  const [settleError, setSettleError] = useState('');
  const [settleSubmitting, setSettleSubmitting] = useState(false);

  // Fetch all group data
  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Get Group info & members
      const groupRes = await client.get(`/groups/${groupId}`);
      setGroup(groupRes.data.group);
      setMembers(groupRes.data.members);

      // Get Expenses
      let expQuery = `/expenses/group/${groupId}`;
      const queryParams = [];
      if (filterCategory) queryParams.push(`category=${filterCategory}`);
      if (filterPaidBy) queryParams.push(`paidBy=${filterPaidBy}`);
      if (filterStartDate) queryParams.push(`startDate=${filterStartDate}`);
      if (filterEndDate) queryParams.push(`endDate=${filterEndDate}`);
      if (queryParams.length > 0) expQuery += `?${queryParams.join('&')}`;
      
      const expensesRes = await client.get(expQuery);
      setExpenses(expensesRes.data.expenses);

      // Get Balances & Settlement Plan
      const balancesRes = await client.get(`/balances/group/${groupId}`);
      setBalances(balancesRes.data.balances);

      const planRes = await client.get(`/balances/group/${groupId}/settlement-plan`);
      setSettlementPlan(planRes.data.plan);

      // Get Settlements log
      const settlementsRes = await client.get(`/settlements/group/${groupId}`);
      setSettlements(settlementsRes.data.settlements);

    } catch (err) {
      console.error('Error fetching group data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [groupId, filterCategory, filterPaidBy, filterStartDate, filterEndDate]);

  // Handle drill-down click (Rohan's Request)
  const fetchUserBreakdown = async (userId) => {
    try {
      setBreakdownLoading(true);
      const res = await client.get(`/balances/group/${groupId}/user/${userId}`);
      setSelectedUserBreakdown(res.data.breakdown);
    } catch (err) {
      console.error('Error fetching user breakdown:', err);
    } finally {
      setBreakdownLoading(false);
    }
  };

  // Pre-fill participants for manual split
  useEffect(() => {
    if (members.length > 0) {
      const initial = {};
      members.forEach(m => {
        if (!m.left_at) { // Only active members by default
          initial[m.user_id] = { selected: true, value: '' };
        }
      });
      setSelectedSplits(initial);
    }
  }, [members, showExpenseModal]);

  const handleCreateExpense = async (e) => {
    e.preventDefault();
    if (!expDesc.trim() || !expAmount || !expDate) {
      return setExpenseError('Please enter description, amount, and date.');
    }

    const amountNum = parseFloat(expAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return setExpenseError('Amount must be a positive number.');
    }

    // Compile splits
    const splitsPayload = [];
    const activeMembers = Object.keys(selectedSplits).filter(id => selectedSplits[id].selected);
    
    if (activeMembers.length === 0) {
      return setExpenseError('Please select at least one person to split the expense with.');
    }

    let sumVals = 0;
    for (const userId of activeMembers) {
      const splitVal = parseFloat(selectedSplits[userId].value);
      if (expSplitType !== 'equal') {
        if (isNaN(splitVal) || splitVal < 0) {
          return setExpenseError('Split values must be non-negative numbers.');
        }
        sumVals += splitVal;
      }
      splitsPayload.push({
        user_id: parseInt(userId),
        amount: expSplitType === 'exact' ? splitVal : undefined,
        percentage: expSplitType === 'percentage' ? splitVal : undefined,
        shares: expSplitType === 'shares' ? parseInt(splitVal) : undefined
      });
    }

    // Validate totals
    if (expSplitType === 'percentage' && Math.abs(sumVals - 100) > 0.01) {
      return setExpenseError(`Percentages must add up to 100%. Current sum: ${sumVals}%`);
    }
    if (expSplitType === 'exact' && Math.abs(sumVals - amountNum) > 0.01) {
      const baseCur = expCurrency;
      return setExpenseError(`Exact amounts must sum to the total expense amount (${baseCur} ${amountNum}). Current sum: ${baseCur} ${sumVals}`);
    }

    try {
      setExpenseError('');
      setExpenseSubmitting(true);
      await client.post(`/expenses/group/${groupId}`, {
        description: expDesc,
        amount: amountNum,
        currency: expCurrency,
        exchange_rate: expCurrency === 'USD' ? parseFloat(expExRate) : undefined,
        category: expCategory,
        expense_date: expDate,
        split_type: expSplitType,
        splits: splitsPayload
      });
      
      // Reset form & Close modal
      setExpDesc('');
      setExpAmount('');
      setExpCurrency('INR');
      setExpExRate('83.50');
      setShowExpenseModal(false);
      fetchData();
    } catch (err) {
      setExpenseError(err.response?.data?.error || 'Failed to add expense.');
    } finally {
      setExpenseSubmitting(false);
    }
  };

  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!memberEmail.trim()) {
      return setMemberError('Email is required.');
    }

    try {
      setMemberError('');
      setMemberSubmitting(true);
      await client.post(`/groups/${groupId}/members`, {
        email: memberEmail,
        joined_at: memberJoinDate
      });
      setMemberEmail('');
      setShowMemberModal(false);
      fetchData();
    } catch (err) {
      setMemberError(err.response?.data?.error || 'Failed to add member.');
    } finally {
      setMemberSubmitting(false);
    }
  };

  const handleUpdateMemberLeft = async (membershipId, leaveDate) => {
    if (!leaveDate) return;
    try {
      await client.put(`/groups/${groupId}/members/${membershipId}`, { left_at: leaveDate });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update leave date.');
    }
  };

  const handleRecordSettlement = async (e) => {
    e.preventDefault();
    if (!settlePayer || !settleReceiver || !settleAmount || !settleDate) {
      return setSettleError('All fields are required.');
    }

    if (settlePayer === settleReceiver) {
      return setSettleError('Payer and receiver cannot be the same person.');
    }

    try {
      setSettleError('');
      setSettleSubmitting(true);
      await client.post(`/settlements/group/${groupId}`, {
        paid_by: parseInt(settlePayer),
        paid_to: parseInt(settleReceiver),
        amount: parseFloat(settleAmount),
        settlement_date: settleDate,
        notes: settleNotes
      });
      setSettleAmount('');
      setSettleNotes('');
      setShowSettleModal(false);
      fetchData();
    } catch (err) {
      setSettleError(err.response?.data?.error || 'Failed to record settlement.');
    } finally {
      setSettleSubmitting(false);
    }
  };

  const handleDeleteExpense = async (id) => {
    if (!window.confirm('Are you sure you want to delete this expense?')) return;
    try {
      await client.delete(`/expenses/${id}`);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete expense.');
    }
  };

  const handleDeleteSettlement = async (id) => {
    if (!window.confirm('Delete this settlement record?')) return;
    try {
      await client.delete(`/settlements/${id}`);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete settlement.');
    }
  };

  if (loading && !group) {
    return <div className="container">Loading group workspace...</div>;
  }

  return (
    <div className="container">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <Link to="/" style={{ fontSize: '0.875rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.5rem' }}>
            ← Back to Dashboard
          </Link>
          <h1 style={{ fontSize: '2.25rem' }}>{group?.name}</h1>
          <p style={{ color: '#64748b', fontSize: '0.95rem', marginTop: '0.25rem' }}>{group?.description || 'Manage expenses, split shares, and settle balances'}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link to={`/groups/${groupId}/import`} className="btn btn-secondary">
            📥 Import Spreadsheet (CSV)
          </Link>
          <button className="btn btn-secondary" onClick={() => setShowMemberModal(true)}>
            👤 Manage Members
          </button>
          <button className="btn btn-primary" onClick={() => setShowExpenseModal(true)}>
            + Add Expense
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-list">
        <button className={`tab-btn ${activeTab === 'expenses' ? 'active' : ''}`} onClick={() => { setActiveTab('expenses'); setSelectedUserBreakdown(null); }}>
          🧾 Expenses ({expenses.length})
        </button>
        <button className={`tab-btn ${activeTab === 'balances' ? 'active' : ''}`} onClick={() => { setActiveTab('balances'); setSelectedUserBreakdown(null); }}>
          ⚖️ Balances & Who Owes Whom
        </button>
        <button className={`tab-btn ${activeTab === 'settlements' ? 'active' : ''}`} onClick={() => { setActiveTab('settlements'); setSelectedUserBreakdown(null); }}>
          💸 Settlement History ({settlements.length})
        </button>
        <button className={`tab-btn ${activeTab === 'members' ? 'active' : ''}`} onClick={() => { setActiveTab('members'); setSelectedUserBreakdown(null); }}>
          📅 Roster & Membership timelines
        </button>
      </div>

      {/* Tab 1: Expenses */}
      {activeTab === 'expenses' && (
        <div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '1rem', backgroundColor: 'white', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: '150px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>Category</label>
              <select className="input" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                <option value="">All Categories</option>
                <option value="Rent">Rent</option>
                <option value="Utilities">Utilities</option>
                <option value="Groceries">Groceries</option>
                <option value="Food">Food</option>
                <option value="Household">Household</option>
                <option value="Travel">Travel</option>
                <option value="Fitness">Fitness</option>
                <option value="Entertainment">Entertainment</option>
              </select>
            </div>
            
            <div style={{ flex: 1, minWidth: '150px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>Paid By</label>
              <select className="input" value={filterPaidBy} onChange={(e) => setFilterPaidBy(e.target.value)}>
                <option value="">All Payers</option>
                {members.map(m => (
                  <option key={m.user_id} value={m.user_id}>{m.name}</option>
                ))}
              </select>
            </div>

            <div style={{ flex: 1, minWidth: '130px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>From Date</label>
              <input type="date" className="input" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} />
            </div>

            <div style={{ flex: 1, minWidth: '130px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>To Date</label>
              <input type="date" className="input" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} />
            </div>

            <button className="btn btn-secondary" onClick={() => {
              setFilterCategory('');
              setFilterPaidBy('');
              setFilterStartDate('');
              setFilterEndDate('');
            }}>Clear</button>
          </div>

          {expenses.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1.5rem', backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <p style={{ color: '#64748b' }}>No expenses found matching the selected filters.</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Paid By</th>
                    <th>Amount</th>
                    <th>INR Equivalent</th>
                    <th>Split Details</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((exp) => {
                    const dateFormatted = new Date(exp.expense_date).toISOString().split('T')[0];
                    const amountFormatted = exp.currency === 'USD' ? `$${exp.amount}` : `₹${exp.amount}`;
                    const isUSD = exp.currency === 'USD';
                    const inrEquivalent = isUSD ? `₹${(parseFloat(exp.amount) * parseFloat(exp.exchange_rate)).toFixed(2)}` : `₹${exp.amount}`;

                    return (
                      <tr key={exp.id}>
                        <td>{dateFormatted}</td>
                        <td>
                          <strong>{exp.description}</strong>
                          {exp.notes && <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.25rem 0 0' }}>{exp.notes}</p>}
                        </td>
                        <td><span className="badge badge-info">{exp.category}</span></td>
                        <td>{exp.paid_by_name}</td>
                        <td><span style={{ fontWeight: 600 }}>{amountFormatted}</span></td>
                        <td><span style={{ color: '#64748b' }}>{isUSD ? `${inrEquivalent} (@ ${exp.exchange_rate})` : '-'}</span></td>
                        <td>
                          <span className="badge badge-success" style={{ textTransform: 'capitalize' }}>
                            {exp.split_type}
                          </span>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                            {exp.splits.map(s => `${s.user_name} (₹${parseFloat(s.amount).toFixed(0)})`).join(', ')}
                          </div>
                        </td>
                        <td>
                          <button 
                            onClick={() => handleDeleteExpense(exp.id)} 
                            style={{ background: 'none', border: 'none', color: '#f43f5e', cursor: 'pointer', fontSize: '1.1rem' }}
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Balances */}
      {activeTab === 'balances' && (
        <div>
          {/* Aisha's "one number" summary */}
          <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Net Balances (Aisha's view)</h3>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            Positive balance means they are owed money. Negative balance means they owe money. Click any member to drill-down and see their expenses.
          </p>
          
          <div className="balance-grid">
            {balances.map((b) => {
              const sign = b.netBalance > 0.01 ? 'positive' : b.netBalance < -0.01 ? 'negative' : 'neutral';
              const symbol = b.netBalance > 0.01 ? '+' : '';
              return (
                <div key={b.id} className="balance-card" style={{ cursor: 'pointer', border: selectedUserBreakdown?.userId === b.id ? '2px solid var(--color-primary)' : '1px solid var(--color-border)' }} onClick={() => fetchUserBreakdown(b.id)}>
                  <div className="balance-card-header">
                    <strong>{b.name}</strong>
                    <span className={`badge ${sign === 'positive' ? 'badge-success' : sign === 'negative' ? 'badge-danger' : 'badge-info'}`}>
                      {sign === 'positive' ? 'Creditor' : sign === 'negative' ? 'Debtor' : 'Settled'}
                    </span>
                  </div>
                  <div className={`balance-val ${sign}`}>
                    {symbol}₹{parseFloat(b.netBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.75rem', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Paid: ₹{parseFloat(b.paidAmount).toFixed(0)}</span>
                    <span>Owed: ₹{parseFloat(b.splitAmount).toFixed(0)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '2rem', alignItems: 'start' }}>
            {/* Aisha's Optimal Settlement Plan */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.25rem' }}>Optimal Settlement Plan</h3>
                <button className="btn btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => setShowSettleModal(true)}>
                  Record Settlement Payment
                </button>
              </div>
              <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                Greedy transaction minimizer to settle all flat accounts in the fewest possible steps.
              </p>

              {settlementPlan.length === 0 ? (
                <div className="alert alert-success" style={{ margin: 0 }}>
                  🎉 All accounts are fully settled! No payments needed.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {settlementPlan.map((p, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                      <div>
                        <strong>{p.from.name}</strong> pays <strong>{p.to.name}</strong>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#f43f5e' }}>
                        ₹{parseFloat(p.amount).toLocaleString('en-IN')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Rohan's Drill-Down Breakdown */}
            <div className="card" style={{ minHeight: '300px' }}>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Rohan's Detailed Expense Breakdown</h3>
              
              {breakdownLoading ? (
                <div>Loading breakdown details...</div>
              ) : !selectedUserBreakdown ? (
                <div style={{ color: '#64748b', textAlign: 'center', padding: '4rem 1rem' }}>
                  💡 Click any member's card above to see exactly which expenses make up their net balance.
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '1rem', borderBottom: '1px solid #e2e8f0', marginBottom: '1.5rem' }}>
                    <span>Showing list for: <strong>{members.find(m => m.user_id === selectedUserBreakdown.userId)?.name}</strong></span>
                    <span style={{ fontWeight: 700 }}>Net Balance: {selectedUserBreakdown.summary.netBalance >= 0 ? '+' : ''}₹{selectedUserBreakdown.summary.netBalance}</span>
                  </div>

                  <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingRight: '0.25rem' }}>
                    <h4 style={{ fontSize: '0.9rem', color: '#64748b' }}>Individual Expense Shares</h4>
                    {selectedUserBreakdown.expenses.map((item, idx) => {
                      const inrDisplay = item.currency === 'USD' ? ` (USD ${item.originalAmount})` : '';
                      return (
                        <div key={idx} style={{ padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.85rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                            <strong>{item.description}</strong>
                            <span style={{ fontWeight: 600, color: item.netEffect >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                              {item.netEffect >= 0 ? '+' : ''}₹{item.netEffect}
                            </span>
                          </div>
                          <div style={{ color: '#64748b', fontSize: '0.75rem', display: 'flex', justifyContent: 'space-between' }}>
                            <span>Total cost: ₹{item.amountInINR.toFixed(0)}{inrDisplay} · Paid by: {item.paidBy.name}</span>
                            <span>Your share: ₹{item.userSplit.toFixed(0)}</span>
                          </div>
                        </div>
                      );
                    })}

                    {selectedUserBreakdown.settlements.length > 0 && (
                      <>
                        <h4 style={{ fontSize: '0.9rem', color: '#64748b', marginTop: '1rem' }}>Settlements & Payments</h4>
                        {selectedUserBreakdown.settlements.map((item, idx) => (
                          <div key={idx} style={{ padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.85rem', backgroundColor: '#f0fdf4' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                              <span>{item.isPayer ? `Paid to ${item.paidTo.name}` : `Received from ${item.paidBy.name}`}</span>
                              <span style={{ fontWeight: 600, color: item.netEffect >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                {item.netEffect >= 0 ? '+' : ''}₹{item.netEffect}
                              </span>
                            </div>
                            <div style={{ color: '#64748b', fontSize: '0.75rem' }}>
                              Date: {new Date(item.date).toISOString().split('T')[0]} {item.notes ? `· Notes: ${item.notes}` : ''}
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Settlement History */}
      {activeTab === 'settlements' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1.25rem' }}>Settlement Ledger</h3>
            <button className="btn btn-primary" onClick={() => setShowSettleModal(true)}>
              + Record Settlement Payment
            </button>
          </div>

          {settlements.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1.5rem', backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <p style={{ color: '#64748b' }}>No settlements recorded yet in this group.</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>From (Debtor)</th>
                    <th>To (Creditor)</th>
                    <th>Amount Paid</th>
                    <th>Notes</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((set) => {
                    const dateFormatted = new Date(set.settlement_date).toISOString().split('T')[0];
                    return (
                      <tr key={set.id}>
                        <td>{dateFormatted}</td>
                        <td style={{ fontWeight: 600 }}>{set.paid_by_name}</td>
                        <td style={{ fontWeight: 600 }}>{set.paid_to_name}</td>
                        <td><span style={{ fontWeight: 700, color: 'var(--color-success)' }}>₹{parseFloat(set.amount).toLocaleString('en-IN')}</span></td>
                        <td>{set.notes || '-'}</td>
                        <td>
                          <button 
                            onClick={() => handleDeleteSettlement(set.id)} 
                            style={{ background: 'none', border: 'none', color: '#f43f5e', cursor: 'pointer', fontSize: '1.1rem' }}
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Members & Timelines (Sam's Temporal Rules) */}
      {activeTab === 'members' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1.25rem' }}>Flat Mates Timeline</h3>
            <button className="btn btn-primary" onClick={() => setShowMemberModal(true)}>
              + Add Flat Mate
            </button>
          </div>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '2rem' }}>
            Temporal membership ensures users are only billed for expenses during their active periods. (e.g. Sam joined April 15, Meera left March 31).
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {members.map((m) => {
              const joinedStr = new Date(m.joined_at).toISOString().split('T')[0];
              const leftStr = m.left_at ? new Date(m.left_at).toISOString().split('T')[0] : null;
              const isActive = !leftStr;

              return (
                <div key={m.membership_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem', border: '1px solid #e2e8f0', borderRadius: '12px', background: isActive ? '#f8fafc' : '#f1f5f9', opacity: isActive ? 1 : 0.7 }}>
                  <div>
                    <h4 style={{ fontSize: '1.1rem', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {m.name}
                      <span className={`badge ${isActive ? 'badge-success' : 'badge-danger'}`}>
                        {isActive ? 'Active Member' : 'Moved Out'}
                      </span>
                    </h4>
                    <p style={{ color: '#64748b', fontSize: '0.85rem' }}>Email: {m.email}</p>
                    <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.85rem', marginTop: '0.5rem', color: '#334155' }}>
                      <span>🔑 Joined: <strong>{joinedStr}</strong></span>
                      {leftStr && <span>🚪 Left: <strong>{leftStr}</strong></span>}
                    </div>
                  </div>

                  {isActive ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input 
                        type="date" 
                        id={`leave-date-${m.membership_id}`}
                        className="input" 
                        style={{ width: '140px', padding: '0.4rem' }} 
                        onChange={(e) => {
                          if (window.confirm(`Set move out date for ${m.name} to ${e.target.value}?`)) {
                            handleUpdateMemberLeft(m.membership_id, e.target.value);
                          }
                        }}
                      />
                      <label htmlFor={`leave-date-${m.membership_id}`} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                        Set Move Out
                      </label>
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Ended tenure</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Expense Modal */}
      {showExpenseModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.25rem' }}>Add Manual Expense</h3>
            {expenseError && <div className="alert alert-danger">{expenseError}</div>}

            <form onSubmit={handleCreateExpense}>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="form-group" style={{ flex: 2 }}>
                  <label htmlFor="description">Description</label>
                  <input
                    id="description"
                    type="text"
                    className="input"
                    placeholder="e.g. Weekly Groceries"
                    value={expDesc}
                    onChange={(e) => setExpDesc(e.target.value)}
                    disabled={expenseSubmitting}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label htmlFor="amount">Amount</label>
                  <input
                    id="amount"
                    type="number"
                    step="0.01"
                    className="input"
                    placeholder="0.00"
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                    disabled={expenseSubmitting}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label htmlFor="currency">Currency</label>
                  <select id="currency" className="input" value={expCurrency} onChange={(e) => setExpCurrency(e.target.value)} disabled={expenseSubmitting}>
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                  </select>
                </div>
                {expCurrency === 'USD' && (
                  <div className="form-group" style={{ flex: 1 }}>
                    <label htmlFor="exRate">Exchange Rate (INR / USD)</label>
                    <input
                      id="exRate"
                      type="number"
                      step="0.01"
                      className="input"
                      value={expExRate}
                      onChange={(e) => setExpExRate(e.target.value)}
                      disabled={expenseSubmitting}
                    />
                  </div>
                )}
                <div className="form-group" style={{ flex: 1 }}>
                  <label htmlFor="expenseDate">Expense Date</label>
                  <input
                    id="expenseDate"
                    type="date"
                    className="input"
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                    disabled={expenseSubmitting}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label htmlFor="category">Category</label>
                  <select id="category" className="input" value={expCategory} onChange={(e) => setExpCategory(e.target.value)} disabled={expenseSubmitting}>
                    <option value="Food">Food</option>
                    <option value="Rent">Rent</option>
                    <option value="Utilities">Utilities</option>
                    <option value="Groceries">Groceries</option>
                    <option value="Household">Household</option>
                    <option value="Travel">Travel</option>
                    <option value="Fitness">Fitness</option>
                    <option value="Entertainment">Entertainment</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label htmlFor="splitType">Split Strategy</label>
                  <select id="splitType" className="input" value={expSplitType} onChange={(e) => setExpSplitType(e.target.value)} disabled={expenseSubmitting}>
                    <option value="equal">Split Equally</option>
                    <option value="exact">Exact Amounts (₹)</option>
                    <option value="percentage">Percentages (%)</option>
                    <option value="shares">Shares/Ratio</option>
                  </select>
                </div>
              </div>

              {/* Splits participants checklist */}
              <div className="form-group">
                <label>Split Between</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto', padding: '0.5rem', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                  {members.map(m => {
                    const isChecked = selectedSplits[m.user_id]?.selected;
                    return (
                      <div key={m.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                          <input
                            type="checkbox"
                            checked={!!isChecked}
                            onChange={(e) => {
                              setSelectedSplits(prev => ({
                                ...prev,
                                [m.user_id]: { ...prev[m.user_id], selected: e.target.checked }
                              }));
                            }}
                          />
                          {m.name} {m.left_at && <span style={{ color: '#f43f5e', fontSize: '0.75rem' }}>(left flat)</span>}
                        </label>

                        {/* If other than equal split is chosen, show a value input */}
                        {isChecked && expSplitType !== 'equal' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <input
                              type="number"
                              className="input"
                              style={{ width: '80px', padding: '0.25rem 0.5rem', textAlign: 'right' }}
                              placeholder={expSplitType === 'exact' ? '0.00' : expSplitType === 'percentage' ? '%' : 'shares'}
                              value={selectedSplits[m.user_id]?.value || ''}
                              onChange={(e) => {
                                setSelectedSplits(prev => ({
                                  ...prev,
                                  [m.user_id]: { ...prev[m.user_id], value: e.target.value }
                                }));
                              }}
                            />
                            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                              {expSplitType === 'exact' ? '₹' : expSplitType === 'percentage' ? '%' : 'sh.'}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowExpenseModal(false)} disabled={expenseSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={expenseSubmitting}>
                  {expenseSubmitting ? 'Saving...' : 'Add Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage/Add Member Modal */}
      {showMemberModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.25rem' }}>Add Group Member</h3>
            {memberError && <div className="alert alert-danger">{memberError}</div>}

            <form onSubmit={handleAddMember}>
              <div className="form-group">
                <label htmlFor="memberEmail">User Email Address</label>
                <input
                  id="memberEmail"
                  type="email"
                  className="input"
                  placeholder="e.g. sam@fairshare.app"
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  disabled={memberSubmitting}
                />
              </div>

              <div className="form-group">
                <label htmlFor="joinDate">Join Date</label>
                <input
                  id="joinDate"
                  type="date"
                  className="input"
                  value={memberJoinDate}
                  onChange={(e) => setMemberJoinDate(e.target.value)}
                  disabled={memberSubmitting}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowMemberModal(false)} disabled={memberSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={memberSubmitting}>
                  {memberSubmitting ? 'Adding...' : 'Add Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Settlement Modal */}
      {showSettleModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.25rem' }}>Record Settlement Payment</h3>
            {settleError && <div className="alert alert-danger">{settleError}</div>}

            <form onSubmit={handleRecordSettlement}>
              <div className="form-group">
                <label htmlFor="settlePayer">Who paid?</label>
                <select id="settlePayer" className="input" value={settlePayer} onChange={(e) => setSettlePayer(e.target.value)} disabled={settleSubmitting}>
                  <option value="">Select Debtor</option>
                  {members.map(m => (
                    <option key={m.user_id} value={m.user_id}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="settleReceiver">Who was paid?</label>
                <select id="settleReceiver" className="input" value={settleReceiver} onChange={(e) => setSettleReceiver(e.target.value)} disabled={settleSubmitting}>
                  <option value="">Select Creditor</option>
                  {members.map(m => (
                    <option key={m.user_id} value={m.user_id}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="settleAmount">Amount (INR)</label>
                <input
                  id="settleAmount"
                  type="number"
                  step="0.01"
                  className="input"
                  placeholder="0.00"
                  value={settleAmount}
                  onChange={(e) => setSettleAmount(e.target.value)}
                  disabled={settleSubmitting}
                />
              </div>

              <div className="form-group">
                <label htmlFor="settleDate">Payment Date</label>
                <input
                  id="settleDate"
                  type="date"
                  className="input"
                  value={settleDate}
                  onChange={(e) => setSettleDate(e.target.value)}
                  disabled={settleSubmitting}
                />
              </div>

              <div className="form-group">
                <label htmlFor="settleNotes">Notes (Optional)</label>
                <input
                  id="settleNotes"
                  type="text"
                  className="input"
                  placeholder="e.g. Settle March rent share"
                  value={settleNotes}
                  onChange={(e) => setSettleNotes(e.target.value)}
                  disabled={settleSubmitting}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowSettleModal(false)} disabled={settleSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={settleSubmitting}>
                  {settleSubmitting ? 'Recording...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
