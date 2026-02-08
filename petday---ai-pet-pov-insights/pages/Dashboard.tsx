
import React from 'react';
import { apiUrl } from '../lib/api';

interface DashboardProps {
  onAnalyze: () => void;
  onGallery?: () => void;
}

function getVisitorId(): string {
  let id = localStorage.getItem('petday_visitor_id');
  if (!id) {
    id = `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('petday_visitor_id', id);
  }
  return id;
}

const Dashboard: React.FC<DashboardProps> = ({ onAnalyze, onGallery }) => {
  const visitorId = React.useMemo(() => getVisitorId(), []);
  const [isUploading, setIsUploading] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [uploadStage, setUploadStage] = React.useState<'idle' | 'initializing' | 'uploading' | 'finalizing'>('idle');
  const [uploadError, setUploadError] = React.useState('');
  const [recentUploads, setRecentUploads] = React.useState<any[]>([]);
  const [showPetNameModal, setShowPetNameModal] = React.useState(false);
  const [petName, setPetName] = React.useState('');
  const [existingPetNames, setExistingPetNames] = React.useState<string[]>([]);
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [showSourcePicker, setShowSourcePicker] = React.useState(false);
  const [showExamplePicker, setShowExamplePicker] = React.useState(false);
  const [exampleVideos, setExampleVideos] = React.useState<any[]>([]);
  const [selectedExample, setSelectedExample] = React.useState<any | null>(null);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(apiUrl(`/api/session/${deleteTarget.id}`), { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Delete failed' }));
        throw new Error(data.error || 'Delete failed');
      }
      setRecentUploads(prev => prev.filter(u => u.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err: any) {
      alert(err.message || 'Failed to delete session');
    } finally {
      setIsDeleting(false);
    }
  };

  const formatSessionForDashboard = (session: any) => ({
    id: session.id,
    name: session.originalName,
    petName: session.petName || '',
    date: new Date(session.createdAt).toLocaleDateString(),
    status: session.status,
    size: session.path ? 'Video Session' : 'N/A',
    processingTime: session.processingTime,
    createdAt: session.createdAt,
    coverUrl: session.coverUrl,
    isSample: !!session.isSample,
    progress: session.progress || null
  });

  const activePollers = React.useRef<Set<string>>(new Set());

  const pollStatus = React.useCallback((sessionId: string) => {
    // Prevent duplicate pollers for the same session
    if (activePollers.current.has(sessionId)) return;
    activePollers.current.add(sessionId);

    const interval = setInterval(async () => {
      try {
        const response = await fetch(apiUrl(`/api/session/${sessionId}`));
        const data = await response.json();
        if (data.status === 'ready' || data.status === 'error') {
          setRecentUploads(prev => prev.map(u =>
            u.id === sessionId ? { ...u, ...formatSessionForDashboard(data) } : u
          ));
          clearInterval(interval);
          activePollers.current.delete(sessionId);
        } else if (data.status === 'processing' && data.progress) {
          setRecentUploads(prev => prev.map(u =>
            u.id === sessionId ? { ...u, progress: data.progress } : u
          ));
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 3000);
  }, []);

  React.useEffect(() => {
    const fetchRecent = async () => {
      try {
        const [sessionsResponse, sampleResponse] = await Promise.all([
          fetch(apiUrl(`/api/sessions?visitorId=${encodeURIComponent(visitorId)}`)),
          fetch(apiUrl('/api/sample-sessions'))
        ]);
        const sessionsData = await sessionsResponse.json();
        const sampleData = await sampleResponse.json();

        const formattedSamples = sampleData.map((session: any) =>
          formatSessionForDashboard({ ...session, isSample: true })
        );

        const sampleIds = new Set(formattedSamples.map((session: any) => session.id));
        const formattedRegular = sessionsData
          .map((session: any) => formatSessionForDashboard(session))
          .filter((session: any) => !sampleIds.has(session.id));

        const allSessions = [...formattedSamples, ...formattedRegular];
        setRecentUploads(allSessions);

        // Start polling for any sessions still processing
        allSessions.forEach(s => {
          if (s.status === 'processing') pollStatus(s.id);
        });
      } catch (e) {
        console.error('Failed to fetch sessions:', e);
      }
    };
    fetchRecent();
  }, [pollStatus]);

  const readErrorMessage = async (response: Response) => {
    try {
      const data = await response.json();
      if (data?.error) return String(data.error);
      return `Request failed (${response.status})`;
    } catch {
      return `Request failed (${response.status})`;
    }
  };

  const parseUploadedRangeEnd = (rangeHeader: string | null): number | null => {
    if (!rangeHeader) return null;
    const match = rangeHeader.match(/(\d+)-(\d+)/);
    if (!match) return null;
    return Number(match[2]);
  };

  const queryUploadedOffset = async (uploadUrl: string, totalSize: number): Promise<number> => {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': '0',
        'Content-Range': `bytes */${totalSize}`
      }
    });

    if (response.status === 308) {
      const end = parseUploadedRangeEnd(response.headers.get('Range'));
      return end == null ? 0 : end + 1;
    }
    if (response.status === 200 || response.status === 201) {
      return totalSize;
    }
    throw new Error(`Failed to query upload status (${response.status})`);
  };

  const uploadFileInChunks = async (
    file: File,
    uploadUrl: string,
    chunkSize: number,
    onProgress: (pct: number) => void
  ) => {
    const size = file.size;
    let offset = 0;

    while (offset < size) {
      const chunkEndExclusive = Math.min(offset + chunkSize, size);
      const chunk = file.slice(offset, chunkEndExclusive);
      const rangeEnd = chunkEndExclusive - 1;
      let uploaded = false;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= 3 && !uploaded; attempt++) {
        try {
          const response = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
              'Content-Range': `bytes ${offset}-${rangeEnd}/${size}`
            },
            body: chunk
          });

          if (response.status === 308) {
            const end = parseUploadedRangeEnd(response.headers.get('Range'));
            offset = end == null ? chunkEndExclusive : end + 1;
            uploaded = true;
          } else if (response.status === 200 || response.status === 201) {
            offset = size;
            uploaded = true;
          } else {
            const bodyText = await response.text();
            throw new Error(`Chunk upload failed (${response.status}): ${bodyText.slice(0, 200)}`);
          }
        } catch (err) {
          lastError = err as Error;
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
            try {
              offset = await queryUploadedOffset(uploadUrl, size);
            } catch {
              // Keep current offset and retry.
            }
          }
        }
      }

      if (!uploaded) {
        throw lastError || new Error('Chunk upload failed after retries');
      }
      onProgress(Math.min(100, Math.round((offset / size) * 100)));
    }
  };
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadError('');
    setPendingFile(file);
    setPetName('');
    // Fetch existing pet names
    try {
      const res = await fetch(apiUrl('/api/pet-names'));
      const names = await res.json();
      setExistingPetNames(names);
    } catch (e) {
      setExistingPetNames([]);
    }
    setShowPetNameModal(true);
    // Reset file input so same file can be re-selected
    event.target.value = '';
  };

  const confirmUpload = async () => {
    if (!pendingFile) return;
    const file = pendingFile;
    const selectedPetName = petName.trim();
    let activeSessionId: string | null = null;
    setShowPetNameModal(false);
    setPendingFile(null);

    setIsUploading(true);
    setUploadProgress(0);
    setUploadStage('initializing');
    setUploadError('');

    try {
      const initResponse = await fetch(apiUrl('/api/uploads/resumable'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type || 'application/octet-stream',
          fileSize: file.size,
          petName: selectedPetName,
          visitorId
        })
      });
      if (!initResponse.ok) {
        throw new Error(await readErrorMessage(initResponse));
      }

      const initData = await initResponse.json();
      const sessionId = initData.sessionId as string;
      const uploadUrl = initData.uploadUrl as string;
      const chunkSize = Number(initData.chunkSize) > 0 ? Number(initData.chunkSize) : 8 * 1024 * 1024;
      activeSessionId = sessionId;

      const newUpload = {
        id: sessionId,
        name: file.name,
        petName: selectedPetName,
        date: 'Just now',
        status: 'uploading',
        size: (file.size / (1024 * 1024)).toFixed(1) + 'MB',
        isSample: false
      };
      setRecentUploads(prev => [newUpload, ...prev.filter(item => item.id !== sessionId)]);

      setUploadStage('uploading');
      await uploadFileInChunks(file, uploadUrl, chunkSize, (pct) => setUploadProgress(pct));

      setUploadStage('finalizing');
      const completeResponse = await fetch(apiUrl('/api/uploads/complete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      if (!completeResponse.ok) {
        throw new Error(await readErrorMessage(completeResponse));
      }

      setRecentUploads(prev =>
        prev.map(u => (u.id === sessionId ? { ...u, status: 'processing' } : u))
      );
      pollStatus(sessionId);
    } catch (error) {
      console.error('Upload failed:', error);
      const message = error instanceof Error ? error.message : 'Upload failed.';
      setUploadError(message);
      if (activeSessionId) {
        setRecentUploads(prev =>
          prev.map(u => (u.id === activeSessionId ? { ...u, status: 'error' } : u))
        );
      }
    } finally {
      setIsUploading(false);
      setUploadStage('idle');
    }
  };

  const confirmExampleUpload = async () => {
    if (!selectedExample) return;
    const example = selectedExample;
    const selectedPetName = petName.trim() || example.suggestedPetName;
    setShowPetNameModal(false);
    setSelectedExample(null);
    setUploadError('');

    try {
      const response = await fetch(apiUrl('/api/uploads/from-example'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exampleId: example.id, petName: selectedPetName, visitorId })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Failed to start example' }));
        throw new Error(data.error || 'Failed to start example');
      }
      const data = await response.json();
      const sessionId = data.sessionId as string;

      const newUpload = {
        id: sessionId,
        name: example.fileName,
        petName: selectedPetName,
        date: 'Just now',
        status: 'processing',
        size: `${example.fileSizeMB}MB`,
        isSample: false
      };
      setRecentUploads(prev => [newUpload, ...prev]);
      pollStatus(sessionId);
    } catch (error) {
      console.error('Example upload failed:', error);
      setUploadError(error instanceof Error ? error.message : 'Failed to start example video.');
    }
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className="p-8 max-w-6xl mx-auto w-full pb-24">
      <div className="flex flex-wrap justify-between items-end gap-4 mb-8">
        <div>
          <h1 className="text-4xl font-black tracking-tight">Upload Pet POV</h1>
          <p className="text-slate-400 mt-2">Bring your pet's perspective to life with AI</p>
        </div>
        <button className="bg-primary/10 text-primary border border-primary/20 px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-primary hover:text-background-dark transition-all flex items-center gap-2">
          <span className="material-symbols-outlined text-lg">grid_view</span>
          View Session Gallery
        </button>
      </div>

      <section className="mb-12">
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-primary/30 to-primary/10 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
          <div className="relative flex flex-col items-center justify-center gap-8 rounded-2xl border-2 border-dashed border-warm-gray/50 bg-card-dark px-6 py-20 text-center transition-all hover:border-primary/50">
            <div className="size-24 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-500">
              <span className="material-symbols-outlined text-5xl">upload_file</span>
            </div>
            <div className="flex flex-col gap-2 max-w-md">
              <h3 className="text-2xl font-bold tracking-tight">Drag and drop video files here</h3>
              <p className="text-slate-400 text-sm">Support for MP4, MOV, and AVI. Resumable cloud upload supports large files (GB-level).</p>
            </div>
            <div className="flex items-center gap-4">
              <input ref={fileInputRef} type="file" className="hidden" accept="video/*" onChange={handleFileUpload} />
              <button
                onClick={() => setShowSourcePicker(true)}
                className="bg-primary text-background-dark px-8 py-3 rounded-xl font-bold shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all flex items-center gap-2 cursor-pointer"
              >
                <span className="material-symbols-outlined">add_circle</span>
                Upload Video
              </button>
              <button className="bg-surface-dark text-white px-8 py-3 rounded-xl font-bold hover:bg-warm-gray/50 transition-all">
                Link GoPro
              </button>
            </div>
          </div>
        </div>
      </section>

      {showPetNameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card-dark border border-warm-gray/30 rounded-2xl p-8 w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-bold mb-1">Which pet is this?</h3>
            <p className="text-slate-400 text-sm mb-6">Select an existing pet or enter a new name.</p>

            {existingPetNames.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {existingPetNames.map((name) => (
                  <button
                    key={name}
                    onClick={() => setPetName(name)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                      petName === name
                        ? 'bg-primary text-background-dark border-primary'
                        : 'bg-surface-dark text-slate-300 border-warm-gray/30 hover:border-primary/50'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}

            <input
              type="text"
              value={petName}
              onChange={(e) => setPetName(e.target.value)}
              placeholder="Enter pet name..."
              className="w-full h-12 px-4 bg-surface-dark border border-warm-gray/30 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-primary mb-6"
              autoFocus
            />

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowPetNameModal(false); setPendingFile(null); setSelectedExample(null); }}
                className="px-6 py-2.5 rounded-xl font-bold text-sm text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={selectedExample ? confirmExampleUpload : confirmUpload}
                className="px-6 py-2.5 rounded-xl font-bold text-sm bg-primary text-background-dark hover:shadow-lg hover:shadow-primary/20 transition-all"
              >
                {selectedExample ? 'Start Analysis' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isUploading && (
        <section className="mb-12 p-6 bg-surface-dark rounded-2xl border border-primary/20">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold">
              {uploadStage === 'initializing'
                ? 'Preparing cloud upload...'
                : uploadStage === 'finalizing'
                  ? 'Finalizing upload...'
                  : 'Uploading to cloud storage...'}
            </h3>
            <span className="text-primary font-bold">{uploadProgress}%</span>
          </div>
          <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${uploadProgress}%` }}></div>
          </div>
        </section>
      )}

      {uploadError && (
        <section className="mb-12 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-sm">
          {uploadError}
        </section>
      )}

      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold tracking-tight px-1 text-white">Recently Uploaded</h2>
          <button onClick={onGallery} className="text-primary text-sm font-bold hover:underline">View all uploads</button>
        </div>
        <div className="bg-surface-dark rounded-2xl border border-warm-gray/30 overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-warm-gray/30 bg-warm-gray/10">
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Video Session</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Pet</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Date</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Processing Time</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-gray/20">
              {recentUploads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500 italic">No recent uploads yet.</td>
                </tr>
              ) : (
                recentUploads.map((upload) => (
                  <tr key={upload.id} className="hover:bg-white/5 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        <div className="w-16 h-10 rounded-lg bg-black overflow-hidden flex items-center justify-center border border-warm-gray/30 shrink-0">
                          {upload.coverUrl ? (
                            <img src={upload.coverUrl} alt={upload.name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="material-symbols-outlined text-slate-500">video_file</span>
                          )}
                        </div>
                        <div className="overflow-hidden">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-bold text-sm truncate">{upload.name}</p>
                            {upload.isSample && (
                              <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                Sample
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500">{upload.size}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400 font-medium">{upload.petName || '—'}</td>
                    <td className="px-6 py-4 text-sm text-slate-400 font-medium">{upload.date}</td>
                    <td className="px-6 py-4 text-sm text-slate-400 font-medium">
                      {upload.processingTime != null
                        ? upload.processingTime >= 60
                          ? `${Math.floor(upload.processingTime / 60)}m ${upload.processingTime % 60}s`
                          : `${upload.processingTime}s`
                        : '—'}
                    </td>
                    <td className="px-6 py-4">
                      {upload.status === 'ready' ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/10">
                          <span className="material-symbols-outlined !text-sm">check_circle</span>
                          Ready
                        </span>
                      ) : upload.status === 'uploading' ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/20 animate-pulse">
                          <span className="material-symbols-outlined !text-sm rotate-spin">sync</span>
                          Uploading
                        </span>
                      ) : upload.status === 'processing' ? (
                        <div className="flex flex-col gap-1 min-w-[140px]">
                          <div className="flex items-center gap-1.5">
                            <span className="material-symbols-outlined !text-sm text-primary rotate-spin">sync</span>
                            <span className="text-[10px] font-bold text-primary">
                              {upload.progress?.stage || 'Processing'}
                            </span>
                            <span className="text-[10px] font-medium text-slate-400">
                              {upload.progress?.percent != null ? `${upload.progress.percent}%` : ''}
                            </span>
                          </div>
                          {upload.progress?.percent != null && (
                            <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
                                style={{ width: `${upload.progress.percent}%` }}
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/10">
                          <span className="material-symbols-outlined !text-sm">error</span>
                          Error
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            localStorage.setItem('currentSessionId', upload.id);
                            onAnalyze();
                          }}
                          disabled={upload.status !== 'ready'}
                          className={`font-bold text-xs px-4 py-2 rounded-lg transition-all whitespace-nowrap ${upload.status === 'ready'
                            ? 'text-primary bg-primary/10 hover:bg-primary hover:text-background-dark'
                            : 'text-slate-500 bg-slate-800 cursor-not-allowed'
                            }`}
                        >
                          See AI Summary
                        </button>
                        {!upload.isSample && (
                          <button
                            onClick={() => setDeleteTarget({ id: upload.id, name: upload.name })}
                            className="flex items-center gap-1 font-bold text-xs px-3 py-2 rounded-lg transition-all text-red-400 bg-red-500/10 hover:bg-red-500 hover:text-white"
                          >
                            <span className="material-symbols-outlined !text-sm">delete</span>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="p-8 rounded-[2.5rem] bg-gradient-to-br from-card-dark to-sidebar-dark border border-primary/10 flex flex-col md:flex-row items-center gap-8 relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-[100px] -mr-32 -mt-32"></div>
        <div className="size-20 rounded-3xl bg-primary flex items-center justify-center shrink-0 shadow-2xl shadow-primary/20 rotate-3 group-hover:rotate-0 transition-transform">
          <span className="material-symbols-outlined text-background-dark text-4xl font-bold">auto_awesome</span>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] bg-primary text-background-dark px-2 py-0.5 rounded">Weekly insight</span>
            <h4 className="text-xl font-bold text-white">Cooper's Social Confidence is Peaking!</h4>
          </div>
          <p className="text-slate-400 text-sm leading-relaxed max-w-2xl">
            Based on recent POV clips, Cooper has increased his "Positive Interaction" time by 15% this week. He's showing less hesitation when meeting new dogs at the park.
            <span className="text-primary font-bold cursor-pointer hover:underline ml-1">View full behavioral report →</span>
          </p>
        </div>
      </div>
      {showSourcePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card-dark border border-warm-gray/30 rounded-2xl p-8 w-full max-w-lg shadow-2xl">
            <h3 className="text-xl font-bold mb-1">Choose Video Source</h3>
            <p className="text-slate-400 text-sm mb-6">Upload from your device or try one of our example videos.</p>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => {
                  setShowSourcePicker(false);
                  fileInputRef.current?.click();
                }}
                className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-warm-gray/30 bg-surface-dark hover:border-primary/50 hover:bg-primary/5 transition-all group"
              >
                <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-3xl">smartphone</span>
                </div>
                <div className="text-center">
                  <p className="font-bold text-sm">From Device</p>
                  <p className="text-slate-500 text-xs mt-1">Upload your own pet video</p>
                </div>
              </button>

              <button
                onClick={async () => {
                  setShowSourcePicker(false);
                  try {
                    const res = await fetch(apiUrl('/api/example-videos'));
                    const data = await res.json();
                    setExampleVideos(data);
                  } catch {
                    setExampleVideos([]);
                  }
                  setShowExamplePicker(true);
                }}
                className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-warm-gray/30 bg-surface-dark hover:border-primary/50 hover:bg-primary/5 transition-all group"
              >
                <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-3xl">video_library</span>
                </div>
                <div className="text-center">
                  <p className="font-bold text-sm">Example Videos</p>
                  <p className="text-slate-500 text-xs mt-1">Try with pre-loaded samples</p>
                </div>
              </button>
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={() => setShowSourcePicker(false)}
                className="px-6 py-2.5 rounded-xl font-bold text-sm text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showExamplePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card-dark border border-warm-gray/30 rounded-2xl p-8 w-full max-w-2xl shadow-2xl max-h-[80vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-1">Choose an Example Video</h3>
            <p className="text-slate-400 text-sm mb-6">Select a pet video to experience the full AI analysis pipeline.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {exampleVideos.map((video: any) => (
                <button
                  key={video.id}
                  onClick={async () => {
                    setSelectedExample(video);
                    setPetName(video.suggestedPetName);
                    setShowExamplePicker(false);
                    try {
                      const res = await fetch(apiUrl('/api/pet-names'));
                      const names = await res.json();
                      setExistingPetNames(names);
                    } catch {
                      setExistingPetNames([]);
                    }
                    setShowPetNameModal(true);
                  }}
                  className="flex items-center gap-4 p-4 rounded-xl border border-warm-gray/30 bg-surface-dark hover:border-primary/50 hover:bg-primary/5 transition-all text-left group"
                >
                  <div className={`size-12 rounded-xl flex items-center justify-center shrink-0 ${
                    video.petType === 'cat'
                      ? 'bg-purple-500/15 text-purple-400'
                      : 'bg-amber-500/15 text-amber-400'
                  }`}>
                    <span className="material-symbols-outlined text-2xl">
                      {video.petType === 'cat' ? 'pets' : 'pets'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{video.label}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                        video.petType === 'cat'
                          ? 'bg-purple-500/20 text-purple-300'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}>
                        {video.petType}
                      </span>
                      <span className="text-xs text-slate-500">{video.fileSizeMB}MB</span>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-slate-500 group-hover:text-primary transition-colors">
                    arrow_forward
                  </span>
                </button>
              ))}
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={() => setShowExamplePicker(false)}
                className="px-6 py-2.5 rounded-xl font-bold text-sm text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card-dark border border-slate-700 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">Delete Session</h3>
            <p className="text-slate-400 text-sm mb-1">
              Are you sure you want to delete <span className="text-white font-semibold">{deleteTarget.name}</span>?
            </p>
            <p className="text-red-400 text-xs mb-6">This action cannot be undone. All associated files and data will be permanently removed.</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-lg text-sm font-bold text-slate-300 bg-slate-700 hover:bg-slate-600 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-red-500 hover:bg-red-600 transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <span className="material-symbols-outlined !text-sm animate-spin">progress_activity</span>
                    Deleting...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined !text-sm">delete</span>
                    Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
