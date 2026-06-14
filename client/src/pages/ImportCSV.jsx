import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import client from '../api/client';

export default function ImportCSV() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  
  const [step, setStep] = useState(1); // 1: Upload, 2: Review, 3: Completed
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [batchId, setBatchId] = useState(null);
  const [batch, setBatch] = useState(null);
  const [anomalies, setAnomalies] = useState([]);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  // Handle file select
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  // Upload file
  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) {
      return setError('Please select a CSV file first.');
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      setError('');
      setUploading(true);
      const res = await client.post(`/import/group/${groupId}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      setBatchId(res.data.batchId);
      
      if (res.data.anomaliesFound > 0) {
        setStep(2);
        fetchBatchDetails(res.data.batchId);
      } else {
        // No anomalies found, auto-confirm
        handleConfirm(res.data.batchId);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload CSV file.');
    } finally {
      setUploading(false);
    }
  };

  // Fetch anomalies for review
  const fetchBatchDetails = async (bId) => {
    try {
      setLoadingBatch(true);
      const res = await client.get(`/import/${bId}`);
      setBatch(res.data.batch);
      setAnomalies(res.data.anomalies);
    } catch (err) {
      setError('Failed to fetch batch anomalies.');
    } finally {
      setLoadingBatch(false);
    }
  };

  // Save single anomaly decision
  const handleResolveAnomaly = async (anomalyId, decision) => {
    try {
      const res = await client.put(`/import/${batchId}/anomalies/${anomalyId}`, {
        user_decision: decision
      });
      
      // Update local state
      setAnomalies(prev => prev.map(an => 
        an.id === anomalyId ? { ...an, user_decision: decision } : an
      ));
    } catch (err) {
      alert('Failed to save decision.');
    }
  };

  // Confirm import batch
  const handleConfirm = async (bId = batchId) => {
    try {
      setError('');
      setConfirming(true);
      const res = await client.post(`/import/${bId}/confirm`, { groupId });
      setReport(res.data);
      setStep(3);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to finalize import.');
    } finally {
      setConfirming(false);
    }
  };

  const allResolved = anomalies.every(an => an.user_decision !== null);

  return (
    <div className="container">
      {/* Back button */}
      <div style={{ marginBottom: '1.5rem' }}>
        <Link to={`/groups/${groupId}`} style={{ fontSize: '0.875rem', color: '#64748b' }}>
          ← Back to Group
        </Link>
      </div>

      {/* Progress Wizard Header */}
      <div style={{ maxWidth: '600px', margin: '0 auto 2.5rem' }}>
        <div className="wizard-steps">
          <div className={`step-indicator ${step >= 1 ? 'completed' : ''}`}>1</div>
          <div className={`step-indicator ${step >= 2 ? (step === 2 ? 'active' : 'completed') : ''}`}>2</div>
          <div className={`step-indicator ${step === 3 ? 'completed' : ''}`}>3</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#64748b', marginTop: '0.5rem' }}>
          <span>Upload CSV</span>
          <span style={{ textAlign: 'center' }}>Review Anomalies</span>
          <span style={{ textAlign: 'right' }}>Import Report</span>
        </div>
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        {/* Step 1: Upload */}
        {step === 1 && (
          <div className="card" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📊</div>
            <h2 style={{ marginBottom: '0.5rem' }}>Import spreadsheet records</h2>
            <p style={{ color: '#64748b', marginBottom: '2rem', maxWidth: '480px', margin: '0 auto 2rem' }}>
              Upload your flat mates' shared spreadsheet (CSV format). The import engine will automatically find date format issues, duplicates, settlements logged as expenses, and currency mismatches.
            </p>

            {error && <div className="alert alert-danger" style={{ maxWidth: '480px', margin: '0 auto 1.5rem' }}>{error}</div>}

            <form onSubmit={handleUpload}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                <input
                  type="file"
                  accept=".csv"
                  id="csv-file-input"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                  disabled={uploading}
                />
                <label 
                  htmlFor="csv-file-input" 
                  className="btn btn-secondary"
                  style={{ padding: '1.5rem 3rem', borderStyle: 'dashed', borderWidth: '2px', borderRadius: '12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
                >
                  <span>📁 {file ? <strong>{file.name}</strong> : 'Choose CSV file'}</span>
                  {!file && <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Limit 10MB · .csv files only</span>}
                </label>

                {file && (
                  <button type="submit" className="btn btn-primary" style={{ padding: '0.75rem 2.5rem' }} disabled={uploading}>
                    {uploading ? 'Analyzing CSV...' : 'Start Import Analysis'}
                  </button>
                )}
              </div>
            </form>

            <div style={{ marginTop: '2rem', fontSize: '0.85rem', color: '#64748b', textAlign: 'left', borderTop: '1px solid #f1f5f9', paddingTop: '1.5rem' }}>
              <strong>Notice:</strong> The CSV file will be analyzed for 14 different anomaly types before anything is stored in the database.
            </div>
          </div>
        )}

        {/* Step 2: Review (Meera's view) */}
        {step === 2 && (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Review CSV Anomalies</h2>
              <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
                We detected <strong>{anomalies.length} anomalies</strong> in the spreadsheet. Meera requires that you approve or reject each decision before finalizing the import.
              </p>
            </div>

            {error && <div className="alert alert-danger">{error}</div>}

            {loadingBatch ? (
              <div style={{ textAlign: 'center', padding: '3rem' }}>Loading anomalies...</div>
            ) : (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
                  {anomalies.map((an) => {
                    const orig = an.original_data;
                    const isResolved = an.user_decision !== null;
                    
                    return (
                      <div key={an.id} className={`anomaly-card severity-${an.severity}`} style={{ opacity: isResolved ? 0.75 : 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                          <span className={`badge ${an.severity === 'error' ? 'badge-danger' : an.severity === 'warning' ? 'badge-warning' : 'badge-info'}`} style={{ fontSize: '0.7rem' }}>
                            Row {an.row_number} · {an.anomaly_type.replace(/_/g, ' ')}
                          </span>
                          {isResolved && <span className="badge badge-success">Decision: {an.user_decision}</span>}
                        </div>

                        <p style={{ fontSize: '0.9rem', marginBottom: '1rem', color: '#334155' }}>
                          {an.description}
                        </p>

                        <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '6px', fontSize: '0.8rem', color: '#64748b', marginBottom: '1rem', overflowX: 'auto', border: '1px solid #e2e8f0' }}>
                          <strong>Original Data:</strong><br />
                          Date: {orig.Date} | Desc: {orig.Description} | Paid By: {orig['Paid By']} | Amount: {orig.Amount} | Splits: {orig['Split Between']}
                        </div>

                        {/* Decision UI based on suggested actions */}
                        <div className="decision-buttons">
                          {an.suggested_action === 'normalize_date' && (
                            <button className={`btn ${an.user_decision === 'accept' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'accept')}>
                              Accept Normalization
                            </button>
                          )}
                          {an.suggested_action === 'strip_symbol' && (
                            <button className={`btn ${an.user_decision === 'accept' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'accept')}>
                              Accept Clean Value
                            </button>
                          )}
                          {an.suggested_action === 'strip_comma' && (
                            <button className={`btn ${an.user_decision === 'accept' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'accept')}>
                              Accept Clean Value
                            </button>
                          )}
                          {an.suggested_action === 'convert_to_settlement' && (
                            <button className={`btn ${an.user_decision === 'accept' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'accept')}>
                              Convert to Settlement Record
                            </button>
                          )}
                          {an.suggested_action === 'apply_exchange_rate' && (
                            <button className={`btn ${an.user_decision === 'accept' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'accept')}>
                              Convert USD to INR (@ ₹83.50)
                            </button>
                          )}
                          {an.suggested_action === 'update_timeline' && (
                            <button className={`btn ${an.user_decision === 'accept' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'accept')}>
                              Apply to Roster Timeline
                            </button>
                          )}
                          {an.suggested_action === 'skip_duplicate' && (
                            <>
                              <button className={`btn ${an.user_decision === 'reject' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'reject')}>
                                Skip Duplicate Row (Recommended)
                              </button>
                              <button className={`btn ${an.user_decision === 'accept' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'accept')}>
                                Keep Both Anyway
                              </button>
                            </>
                          )}
                          {an.suggested_action === 'keep_one' && (
                            <>
                              <button className={`btn ${an.user_decision === 'accept' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'accept')}>
                                Keep this row
                              </button>
                              <button className={`btn ${an.user_decision === 'reject' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'reject')}>
                                Skip this row
                              </button>
                            </>
                          )}
                          {an.suggested_action === 'exclude_member' && (
                            <>
                              <button className={`btn ${an.user_decision === 'exclude' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'exclude')}>
                                Exclude Inactive Member (Recommended)
                              </button>
                              <button className={`btn ${an.user_decision === 'keep' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'keep')}>
                                Keep Member in Split
                              </button>
                            </>
                          )}
                          {an.suggested_action === 'ask_user' && (
                            <>
                              <button className={`btn ${an.user_decision === 'convert' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'convert')}>
                                Treat as Settlement
                              </button>
                              <button className={`btn ${an.user_decision === 'refund' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'refund')}>
                                Treat as Expense Refund
                              </button>
                            </>
                          )}
                          {an.suggested_action === 'keep_anyway' && (
                            <>
                              <button className={`btn ${an.user_decision === 'accept' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'accept')}>
                                Keep Row
                              </button>
                              <button className={`btn ${an.user_decision === 'skip' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'skip')}>
                                Skip Row
                              </button>
                            </>
                          )}
                          {an.suggested_action === 'skip' && (
                            <>
                              <button className={`btn ${an.user_decision === 'reject' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => handleResolveAnomaly(an.id, 'reject')}>
                                Skip Row
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '1.5rem' }}>
                  <span style={{ fontSize: '0.9rem', color: '#64748b' }}>
                    {allResolved ? '✅ All decisions recorded' : '⚠️ Please make a decision for all anomalies above'}
                  </span>
                  <button className="btn btn-primary" style={{ padding: '0.75rem 2rem' }} disabled={!allResolved || confirming} onClick={() => handleConfirm()}>
                    {confirming ? 'Saving records...' : 'Confirm and Finalize Import'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Completed Report */}
        {step === 3 && (
          <div className="card" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
            <h2 style={{ marginBottom: '0.5rem' }}>CSV Import Completed</h2>
            <p style={{ color: '#64748b', marginBottom: '2.5rem' }}>
              The data has been successfully imported to group accounts.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', maxWidth: '400px', margin: '0 auto 2.5rem' }}>
              <div style={{ padding: '1rem', backgroundColor: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-success)' }}>{report?.importedCount}</div>
                <div style={{ fontSize: '0.75rem', color: '#166534', fontWeight: 600 }}>Rows Imported</div>
              </div>
              <div style={{ padding: '1rem', backgroundColor: '#fef2f2', borderRadius: '8px', border: '1px solid #fecaca' }}>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-danger)' }}>{report?.skippedCount}</div>
                <div style={{ fontSize: '0.75rem', color: '#991b1b', fontWeight: 600 }}>Rows Skipped</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
              <Link to={`/groups/${groupId}`} className="btn btn-primary" style={{ padding: '0.75rem 2rem' }}>
                Go to Group Workspace
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
