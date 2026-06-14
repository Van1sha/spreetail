import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const { user } = useAuth();

  const fetchGroups = async () => {
    try {
      setLoading(true);
      const res = await client.get('/groups');
      setGroups(res.data.groups);
    } catch (err) {
      console.error('Error fetching groups:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!newGroupName.trim()) {
      return setError('Group name is required.');
    }

    try {
      setError('');
      setCreating(true);
      await client.post('/groups', {
        name: newGroupName,
        description: newGroupDesc
      });
      setNewGroupName('');
      setNewGroupDesc('');
      setShowModal(false);
      fetchGroups();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create group.');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteGroup = async (groupId) => {
    if (!window.confirm('Are you sure you want to delete this group? All expenses and balances will be lost.')) {
      return;
    }
    try {
      await client.delete(`/groups/${groupId}`);
      fetchGroups();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete group. Only the creator can do so.');
    }
  };

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2.25rem', marginBottom: '0.25rem' }}>Expenses Dashboard</h1>
          <p style={{ color: '#64748b' }}>Welcome to FairShare, {user?.name}. Manage and settle flat expenses easily.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          + Create New Group
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', margin: '3rem 0' }}>
          <div>Loading groups...</div>
        </div>
      ) : groups.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏡</div>
          <h3 style={{ marginBottom: '0.5rem' }}>No groups found</h3>
          <p style={{ color: '#64748b', marginBottom: '1.5rem', maxWidth: '420px', margin: '0 auto 1.5rem' }}>
            Get started by creating a new group for your flat mates or importing historical spreadsheet exports.
          </p>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            Create a Group
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
          {groups.map((group) => (
            <div key={group.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '180px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <h3 style={{ fontSize: '1.25rem' }}>
                    <Link to={`/groups/${group.id}`} style={{ color: 'inherit' }}>{group.name}</Link>
                  </h3>
                  {group.created_by === user?.id && (
                    <button 
                      onClick={() => handleDeleteGroup(group.id)} 
                      style={{ background: 'none', border: 'none', color: '#f43f5e', cursor: 'pointer', fontSize: '0.8rem' }}
                      title="Delete Group"
                    >
                      🗑️
                    </button>
                  )}
                </div>
                <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '1rem', lineClamp: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {group.description || 'No description provided.'}
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: '#64748b' }}>
                  <span>👥 <strong>{group.member_count}</strong> members</span>
                  <span>🧾 <strong>{group.expense_count}</strong> expenses</span>
                </div>
                <Link to={`/groups/${group.id}`} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                  Open Group
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Group Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Create New Group</h3>
            
            {error && <div className="alert alert-danger">{error}</div>}

            <form onSubmit={handleCreateGroup}>
              <div className="form-group">
                <label htmlFor="groupName">Group Name</label>
                <input
                  id="groupName"
                  type="text"
                  className="input"
                  placeholder="e.g. 4B Flat Mates"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  disabled={creating}
                />
              </div>

              <div className="form-group">
                <label htmlFor="groupDesc">Description (Optional)</label>
                <textarea
                  id="groupDesc"
                  className="input"
                  style={{ height: '80px', resize: 'vertical' }}
                  placeholder="e.g. Shared expenses for flat chores, rent, and trips"
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  disabled={creating}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={creating}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating...' : 'Create Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
