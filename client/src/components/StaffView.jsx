import { useState } from 'react';
import { compressImage } from '../utils/compressImage';
import { showToast } from '../utils/toast';
import { getStatusStyle } from '../utils/statusUtils';

const BLUE = '#1B3A6B';
const ORANGE = '#E07B2A';

export default function StaffView({ token }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (!search.trim()) return;
    setSearching(true);
    setResults([]);
    setSelectedJob(null);
    try {
      const res = await fetch(`/api/contacts?search=${encodeURIComponent(search)}&limit=10`, {
        headers: { 'x-auth-token': token },
      });
      const data = await res.json();
      setResults(data.contacts || []);
      if ((data.contacts || []).length === 0) showToast('No jobs found for that address.', 'warn');
    } catch {
      showToast('Search failed. Please try again.', 'error');
    } finally {
      setSearching(false);
    }
  };

  const handlePhotoUpload = async (e) => {
    if (!selectedJob) return;
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    let successCount = 0;
    for (const file of files) {
      try {
        const compressed = await compressImage(file, 1400, 0.82);
        const form = new FormData();
        form.append('photo', compressed, file.name);
        form.append('location_label', 'Field Upload');
        const res = await fetch(`/api/contacts/${selectedJob.id}/photos`, {
          method: 'POST',
          headers: { 'x-auth-token': token },
          body: form,
        });
        if (res.ok) successCount++;
      } catch {
        /* skip failed photo */
      }
    }
    setUploading(false);
    setUploadedCount((c) => c + successCount);
    if (successCount > 0) showToast(`${successCount} photo(s) uploaded successfully.`, 'success');
    else showToast('Photo upload failed. Please try again.', 'error');
    e.target.value = '';
  };

  return (
    <div style={{ padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <div
        style={{
          background: BLUE,
          borderRadius: 10,
          padding: '20px 22px',
          marginBottom: 24,
          color: 'white',
        }}
      >
        <div style={{ fontSize: 11, color: ORANGE, fontWeight: 700, letterSpacing: '0.05em' }}>
          PREFERRED BUILDERS
        </div>
        <div style={{ fontSize: 20, fontWeight: 'bold', marginTop: 4 }}>
          👷 Staff / Field Portal
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
          Search by address to upload site photos
        </div>
      </div>

      <div
        style={{
          background: 'white',
          borderRadius: 10,
          padding: 20,
          marginBottom: 16,
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}
      >
        <label
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#333',
            display: 'block',
            marginBottom: 8,
          }}
        >
          Job Address Search
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Enter street address or city…"
            style={{
              flex: 1,
              padding: '10px 12px',
              border: '1px solid #ddd',
              borderRadius: 7,
              fontSize: 14,
            }}
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            style={{
              background: BLUE,
              color: 'white',
              border: 'none',
              borderRadius: 7,
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              opacity: searching ? 0.6 : 1,
            }}
          >
            {searching ? '…' : 'Search'}
          </button>
        </div>
      </div>

      {results.length > 0 && !selectedJob && (
        <div
          style={{
            background: 'white',
            borderRadius: 10,
            padding: 16,
            marginBottom: 16,
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 10 }}>
            Select the correct job:
          </div>
          {results.map((contact) => (
            <button
              key={contact.id}
              onClick={() => {
                setSelectedJob(contact);
                setUploadedCount(0);
              }}
              style={{
                width: '100%',
                textAlign: 'left',
                background: '#f8f9fa',
                border: '1px solid #e0e0e0',
                borderRadius: 8,
                padding: '12px 14px',
                marginBottom: 8,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              <div style={{ fontWeight: 600, color: '#222' }}>{contact.name}</div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                {[contact.address, contact.city, contact.state].filter(Boolean).join(', ')}
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedJob && (
        <div
          style={{
            background: 'white',
            borderRadius: 10,
            padding: 20,
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: 18,
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#222' }}>{selectedJob.name}</div>
              <div style={{ fontSize: 13, color: '#666', marginTop: 3 }}>
                {[selectedJob.address, selectedJob.city, selectedJob.state]
                  .filter(Boolean)
                  .join(', ')}
              </div>
              {selectedJob.status &&
                (() => {
                  const s = getStatusStyle(selectedJob.status);
                  return (
                    <span
                      style={{
                        display: 'inline-block',
                        marginTop: 6,
                        background: s.bg,
                        color: s.color,
                        fontSize: 10,
                        fontWeight: 700,
                        borderRadius: 12,
                        padding: '3px 10px',
                      }}
                    >
                      {s.label}
                    </span>
                  );
                })()}
            </div>
            <button
              onClick={() => {
                setSelectedJob(null);
                setResults([]);
                setSearch('');
              }}
              style={{
                background: 'none',
                border: '1px solid #ddd',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 12,
                cursor: 'pointer',
                color: '#666',
              }}
            >
              Change
            </button>
          </div>

          <label
            style={{
              display: 'block',
              background: uploading ? '#f0f0f0' : ORANGE,
              color: uploading ? '#999' : 'white',
              borderRadius: 8,
              padding: '14px',
              textAlign: 'center',
              cursor: uploading ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              fontSize: 15,
              transition: 'background 0.2s',
            }}
          >
            {uploading ? 'Uploading…' : '📷 Upload Site Photos'}
            <input
              type="file"
              multiple
              accept="image/*"
              capture="environment"
              onChange={handlePhotoUpload}
              disabled={uploading}
              style={{ display: 'none' }}
            />
          </label>

          {uploadedCount > 0 && (
            <div
              style={{
                marginTop: 14,
                background: '#f0fdf4',
                border: '1px solid #86efac',
                borderRadius: 8,
                padding: '10px 14px',
                color: '#166534',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'center',
              }}
            >
              ✅ {uploadedCount} photo(s) uploaded this session
            </div>
          )}
        </div>
      )}
    </div>
  );
}
