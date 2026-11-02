/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Search,
  Lock,
  Plus,
  Upload,
  Trash2,
  X,
  FileText,
  CheckCircle2,
  AlertCircle,
  LogOut,
  School,
  UserCheck,
  BookOpen,
  SlidersHorizontal,
  ArrowUpRight,
} from 'lucide-react';
import {
  ADMIN_PASSWORD,
  BUCKET,
  CACHE_KEY,
  OLD_NAME,
  DEFAULT_LOGO,
  DEFAULTS,
  PdfItem,
  PortalData,
  ToastMsg,
  normalizePdfUrl,
  shrinkImage,
  ensureSupabaseClient,
} from './types';
import PdfViewer from './PdfViewer';

export default function App() {
  const [appData, setAppData] = useState<PortalData>(() => {
    let cached: Partial<PortalData> | null = null;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) cached = JSON.parse(raw);
    } catch (_) {}
    const merged: PortalData = {
      ...DEFAULTS,
      ...(cached || {}),
    };
    merged.pdfs = (merged.pdfs || []).filter(
      (p) => p && p.url && !String(p.url).startsWith('blob:')
    );
    if (!merged.schoolName || merged.schoolName === OLD_NAME) {
      merged.schoolName = DEFAULTS.schoolName;
    }
    return merged;
  });

  const [loaded, setLoaded] = useState<boolean>(() => {
    try {
      return !!localStorage.getItem(CACHE_KEY);
    } catch (_) {
      return false;
    }
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'az'>('newest');
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [adminPdfTitle, setAdminPdfTitle] = useState('');
  const [adminPdfUrl, setAdminPdfUrl] = useState('');
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const [adminSchoolInput, setAdminSchoolInput] = useState('');
  const [adminTeacherInput, setAdminTeacherInput] = useState('');
  const [adminLogoPreview, setAdminLogoPreview] = useState('');
  const [pendingLogo, setPendingLogo] = useState<string | null>(null);
  const [pdfToDelete, setPdfToDelete] = useState<PdfItem | null>(null);

  const [activePdf, setActivePdf] = useState<PdfItem | null>(null);

  const sbRef = useRef<any>(null);

  const addToast = useCallback(
    (message: string, type: 'success' | 'error' = 'success') => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(
        () => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        },
        type === 'error' ? 5000 : 2800
      );
    },
    []
  );

  const saveCache = useCallback((data: PortalData) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (_) {}
  }, []);

  const fetchRemote = useCallback(async () => {
    if (!sbRef.current) {
      sbRef.current = await ensureSupabaseClient();
    }

    const sb = sbRef.current;
    if (!sb) {
      setLoaded(true);
      return;
    }

    try {
      const { data, error } = await sb
        .from('portal_config')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setAppData((prev) => {
          let sName = data.school_name || prev.schoolName;
          if (!sName || sName === OLD_NAME) sName = DEFAULTS.schoolName;
          const updated: PortalData = {
            schoolName: sName,
            teacherName: data.teacher_name || prev.teacherName,
            logoUrl: data.logo_url || prev.logoUrl,
            pdfs: Array.isArray(data.pdfs) ? data.pdfs : [],
          };
          saveCache(updated);
          return updated;
        });
      }
    } catch (err) {
      console.error('Sync error:', err);
      if (!localStorage.getItem(CACHE_KEY)) {
        addToast('Could not load latest data. Check your connection.', 'error');
      }
    } finally {
      setLoaded(true);
    }
  }, [addToast, saveCache]);

  useEffect(() => {
    fetchRemote();
  }, [fetchRemote]);

  useEffect(() => {
    if (loaded) {
      document.title = `Mathematics Portal - ${appData.teacherName}`;
    }
  }, [loaded, appData.teacherName]);

  const persistData = useCallback(
    async (nextData: PortalData): Promise<boolean> => {
      setAppData(nextData);
      saveCache(nextData);
      if (!sbRef.current) {
        sbRef.current = await ensureSupabaseClient();
      }
      const sb = sbRef.current;
      if (!sb) {
        addToast('Supabase not loaded.', 'error');
        return false;
      }
      const { error } = await sb.from('portal_config').upsert({
        id: 1,
        school_name: nextData.schoolName,
        teacher_name: nextData.teacherName,
        logo_url: nextData.logoUrl,
        pdfs: nextData.pdfs,
      });
      if (error) {
        addToast('Save failed: ' + error.message, 'error');
        await fetchRemote();
        return false;
      }
      addToast('Saved');
      return true;
    },
    [addToast, fetchRemote, saveCache]
  );

  const isAdminAuthenticated = () => sessionStorage.getItem('adminOk') === '1';

  const handleOpenAdminClick = () => {
    if (isAdminAuthenticated()) {
      setAdminSchoolInput(appData.schoolName);
      setAdminTeacherInput(appData.teacherName);
      setAdminLogoPreview(appData.logoUrl || DEFAULT_LOGO);
      setPendingLogo(null);
      setIsAdminOpen(true);
    } else {
      setLoginError('');
      setLoginPassword('');
      setIsLoginOpen(true);
    }
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginPassword !== ADMIN_PASSWORD) {
      setLoginError('Wrong password.');
      return;
    }
    sessionStorage.setItem('adminOk', '1');
    setLoginError('');
    setLoginPassword('');
    setIsLoginOpen(false);
    setAdminSchoolInput(appData.schoolName);
    setAdminTeacherInput(appData.teacherName);
    setAdminLogoPreview(appData.logoUrl || DEFAULT_LOGO);
    setPendingLogo(null);
    setIsAdminOpen(true);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('adminOk');
    setIsAdminOpen(false);
    addToast('Signed out');
  };

  const requireAdminGuard = (): boolean => {
    if (isAdminAuthenticated()) return true;
    setIsAdminOpen(false);
    setIsLoginOpen(true);
    addToast('Please sign in as admin first.', 'error');
    return false;
  };

  const handleAddPdfLink = async () => {
    if (!requireAdminGuard()) return;
    const title = adminPdfTitle.trim();
    const raw = adminPdfUrl.trim();
    if (!title || !raw) {
      addToast('Enter both the PDF title and link.', 'error');
      return;
    }
    if (!/^https?:\/\//i.test(raw)) {
      addToast('The link must start with http:// or https://', 'error');
      return;
    }
    const nextPdfs = [
      ...appData.pdfs,
      { id: 'pdf-' + Date.now(), title, url: normalizePdfUrl(raw) },
    ];
    setAdminPdfTitle('');
    setAdminPdfUrl('');
    await persistData({ ...appData, pdfs: nextPdfs });
  };

  const handleLocalFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!requireAdminGuard()) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      addToast('Choose a PDF file.', 'error');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      addToast('PDF is larger than 50 MB.', 'error');
      return;
    }
    if (!sbRef.current) {
      sbRef.current = await ensureSupabaseClient();
    }
    const sb = sbRef.current;
    if (!sb) {
      addToast('Supabase not loaded.', 'error');
      return;
    }

    const title = adminPdfTitle.trim() || file.name.replace(/\.pdf$/i, '');
    setIsUploadingPdf(true);
    const path = `${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
    const { error } = await sb.storage
      .from(BUCKET)
      .upload(path, file, { contentType: 'application/pdf' });
    setIsUploadingPdf(false);

    if (error) {
      addToast('Upload failed: ' + error.message, 'error');
      return;
    }

    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    const nextPdfs = [
      ...appData.pdfs,
      { id: 'pdf-' + Date.now(), title, url: data.publicUrl, path },
    ];
    setAdminPdfTitle('');
    await persistData({ ...appData, pdfs: nextPdfs });
  };

  const confirmDeletePdf = async () => {
    if (!pdfToDelete) return;
    if (!requireAdminGuard()) return;
    const item = pdfToDelete;
    setPdfToDelete(null);
    const nextPdfs = appData.pdfs.filter((p) => p.id !== item.id);
    const ok = await persistData({ ...appData, pdfs: nextPdfs });
    if (ok && item.path && sbRef.current) {
      sbRef.current.storage.from(BUCKET).remove([item.path]);
    }
  };

  const handleLogoFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const shrunk = await shrinkImage(file);
      setPendingLogo(shrunk);
      setAdminLogoPreview(shrunk);
    } catch (_) {
      addToast('Could not read that image.', 'error');
    }
  };

  const handleSaveBranding = async () => {
    if (!requireAdminGuard()) return;
    const nextData: PortalData = {
      ...appData,
      schoolName: adminSchoolInput.trim() || DEFAULTS.schoolName,
      teacherName: adminTeacherInput.trim() || DEFAULTS.teacherName,
      logoUrl: pendingLogo || appData.logoUrl,
    };
    setPendingLogo(null);
    if (await persistData(nextData)) {
      setIsAdminOpen(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pdfToDelete) {
          setPdfToDelete(null);
          return;
        }
        if (isLoginOpen) setIsLoginOpen(false);
        if (isAdminOpen) setIsAdminOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLoginOpen, isAdminOpen, pdfToDelete]);

  const filteredPdfs = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = appData.pdfs.filter(
      (p) => !q || p.title.toLowerCase().includes(q)
    );
    if (sortOrder === 'az') {
      return [...list].sort((a, b) => a.title.localeCompare(b.title));
    }
    return list;
  }, [appData.pdfs, searchQuery, sortOrder]);

  return (
    <div className="min-h-dvh flex flex-col bg-[#090d16] text-slate-100 selection:bg-sky-500/30">
      {/* ==================== TOP BAR (HOME VIEW ONLY) ==================== */}
      {!activePdf && (
        <header className="sticky top-0 z-30 h-16 bg-[#090d16]/85 backdrop-blur-md border-b border-slate-800/80 px-4 sm:px-8 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="text-base sm:text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 truncate max-w-[220px] sm:max-w-md"
          >
            {loaded ? appData.schoolName : 'Mathematics Portal'}
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
            <a
              href="#institution"
              className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              Institution
            </a>
            <a
              href="#library"
              className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              Study Library
            </a>
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('search-input');
                el?.focus();
              }}
              className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Quick Search
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleOpenAdminClick}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 hover:border-amber-400/50 transition-all cursor-pointer whitespace-nowrap shrink-0"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>Admin</span>
            </button>
          </div>
        </header>
      )}

      {/* ==================== HOME VIEW ==================== */}
      {!activePdf && (
        <main
          id="top"
          className="flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-8 pt-6 sm:pt-10 pb-24"
        >
          {/* Academic Institution Crest Banner */}
          <section
            id="institution"
            className={`relative rounded-2xl overflow-hidden border border-slate-800/90 bg-gradient-to-br from-slate-900 via-[#0f172a] to-[#0b1329] p-6 sm:p-10 mb-10 sm:mb-12 shadow-2xl transition-opacity duration-300 ${
              !loaded ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
          >
            <div
              className="absolute inset-0 opacity-[0.04] pointer-events-none"
              style={{
                backgroundImage:
                  'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
                backgroundSize: '32px 32px',
              }}
            />

            <div className="relative z-10 flex flex-col md:flex-row items-center md:items-start gap-6 sm:gap-8 text-center md:text-left">
              <div className="relative shrink-0">
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-white p-2 border-2 border-amber-400/60 shadow-xl flex items-center justify-center overflow-hidden">
                  <img
                    src={appData.logoUrl || DEFAULT_LOGO}
                    alt="School logo"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = DEFAULT_LOGO;
                    }}
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold uppercase tracking-widest text-sky-400 mb-2">
                  Department of Mathematics · Academic Resource Repository
                </div>

                <h1
                  className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-white tracking-tight leading-tight mb-4"
                  style={{ textWrap: 'balance' }}
                >
                  {appData.schoolName}
                </h1>

                <div className="pt-4 border-t border-slate-800/90 flex flex-wrap items-center justify-center md:justify-start gap-y-2 gap-x-6 text-sm text-slate-300">
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-slate-400">Subject Teacher:</span>
                    <span className="font-semibold text-white">
                      {appData.teacherName}
                    </span>
                  </div>
                  <span
                    className="hidden sm:inline text-slate-700"
                    aria-hidden="true"
                  >
                    ·
                  </span>
                  <div className="flex items-center gap-2 text-slate-400">
                    <BookOpen className="w-4 h-4 text-sky-400 shrink-0" />
                    <span className="font-mono text-slate-200">
                      {appData.pdfs.length}
                    </span>
                    <span>
                      PDF{appData.pdfs.length === 1 ? '' : 's'} available
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Study Material Section */}
          <section id="library" className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-slate-800/80">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
                  Mathematics Study Material
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  Select any PDF below to open the full-screen reader with live annotation tools.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-72">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="search-input"
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search PDFs"
                    aria-label="Search PDFs"
                    className="w-full pl-10 pr-8 py-2 bg-slate-900/90 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500 transition-colors"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-lg shrink-0">
                  <button
                    type="button"
                    onClick={() => setSortOrder('newest')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      sortOrder === 'newest'
                        ? 'bg-slate-800 text-sky-300 shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Default
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortOrder('az')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      sortOrder === 'az'
                        ? 'bg-slate-800 text-sky-300 shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    A–Z
                  </button>
                </div>
              </div>
            </div>

            {!loaded ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="h-40 rounded-xl bg-slate-900/70 border border-slate-800/80 p-6 flex flex-col justify-between animate-pulse"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-11 h-11 rounded-lg bg-slate-800 shrink-0" />
                      <div className="space-y-2.5 flex-1">
                        <div className="h-4 bg-slate-800 rounded w-4/5" />
                        <div className="h-3 bg-slate-800/70 rounded w-1/2" />
                      </div>
                    </div>
                    <div className="h-3 bg-slate-800/60 rounded w-1/3" />
                  </div>
                ))}
              </div>
            ) : filteredPdfs.length === 0 ? (
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-6 py-16 text-center max-w-lg mx-auto my-4">
                <div className="w-12 h-12 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center mx-auto mb-4 text-slate-400">
                  <FileText className="w-6 h-6" />
                </div>
                <h3 className="text-base font-semibold text-slate-200 mb-1">
                  {appData.pdfs.length > 0
                    ? 'No PDF matches your search.'
                    : 'No PDFs have been added yet.'}
                </h3>
                <p className="text-sm text-slate-400 mb-6">
                  {appData.pdfs.length > 0
                    ? `No study material matched "${searchQuery}".`
                    : 'Use the Admin Panel to upload PDF files or save GitHub PDF links.'}
                </p>
                {appData.pdfs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-sky-500 text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer"
                  >
                    Reset Search
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredPdfs.map((pdf, idx) => {
                  const hasSavedNotes = (() => {
                    try {
                      const raw = localStorage.getItem('pdfAnn:' + pdf.id);
                      if (!raw) return false;
                      const parsed = JSON.parse(raw);
                      return Object.values(parsed).some(
                        (arr: any) => Array.isArray(arr) && arr.length > 0
                      );
                    } catch (_) {
                      return false;
                    }
                  })();

                  return (
                    <button
                      key={pdf.id}
                      type="button"
                      onClick={() => setActivePdf(pdf)}
                      className="group relative text-left rounded-xl bg-slate-900/75 hover:bg-slate-900 border border-slate-800/90 hover:border-sky-500/60 p-5 sm:p-6 flex flex-col justify-between gap-6 transition-all duration-150 hover:-translate-y-0.5 shadow-lg hover:shadow-sky-950/20 cursor-pointer"
                    >
                      <div className="flex items-start gap-4">
                        <div className="w-11 h-11 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center shrink-0 group-hover:bg-sky-500 group-hover:text-slate-950 transition-colors">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mb-1">
                            <span>
                              #{String(idx + 1).padStart(2, '0')}
                            </span>
                            {hasSavedNotes && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-amber-400 font-sans font-medium">
                                  Annotated
                                </span>
                              </>
                            )}
                          </div>
                          <h3 className="text-base font-semibold text-slate-100 group-hover:text-white leading-snug line-clamp-2 break-words">
                            {pdf.title}
                          </h3>
                        </div>
                      </div>

                      <div className="pt-3.5 border-t border-slate-800/80 flex items-center justify-between gap-2 text-xs text-slate-400">
                        <div className="truncate">
                          <span>By {appData.teacherName}</span>
                          <span className="mx-1.5" aria-hidden="true">
                            ·
                          </span>
                          <span>Mathematics PDF</span>
                        </div>
                        <span className="inline-flex items-center gap-1 font-semibold text-sky-400 group-hover:translate-x-0.5 transition-transform shrink-0">
                          <span>Open PDF</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      )}

      {/* ==================== FOOTER (HOME VIEW ONLY) ==================== */}
      {!activePdf && (
        <footer className="border-t border-slate-900 bg-[#070a12] py-6 px-4 sm:px-8 text-xs text-slate-500">
          <div className="max-w-[1200px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="truncate max-w-full">
              {appData.schoolName} · Department of Mathematics
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <span>Subject Teacher: {appData.teacherName}</span>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={handleOpenAdminClick}
                className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                Admin Panel
              </button>
            </div>
          </div>
        </footer>
      )}

      {/* ==================== FULLSCREEN PDF VIEWER ==================== */}
      {activePdf && (
        <PdfViewer
          item={activePdf}
          onClose={() => setActivePdf(null)}
          addToast={addToast}
        />
      )}

      {/* ==================== CONFIRM DELETE PDF MODAL ==================== */}
      {pdfToDelete && (
        <div
          className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPdfToDelete(null);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl">
            <h3 className="text-base font-bold text-slate-100 mb-2">
              Delete "{pdfToDelete.title}"?
            </h3>
            <p className="text-xs text-slate-400 mb-5 leading-relaxed">
              This PDF will be permanently removed from the study library.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPdfToDelete(null)}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeletePdf}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-rose-500 text-white hover:bg-rose-600 cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== ADMIN SIGN IN MODAL ==================== */}
      {isLoginOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="login-heading"
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setIsLoginOpen(false);
          }}
        >
          <form
            onSubmit={handleLoginSubmit}
            className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Lock className="w-4 h-4" />
                </div>
                <h3 id="login-heading" className="text-base font-bold text-white">
                  Admin sign in
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsLoginOpen(false)}
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mb-4">
              <label
                htmlFor="login-pass"
                className="block text-xs font-semibold text-slate-300 mb-2"
              >
                Admin password
              </label>
              <input
                id="login-pass"
                type="password"
                required
                autoFocus
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>

            {loginError && (
              <div
                role="alert"
                className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 mb-4"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-lg bg-sky-400 hover:bg-sky-300 text-slate-950 font-bold text-sm transition-colors cursor-pointer"
            >
              Sign in
            </button>
          </form>
        </div>
      )}

      {/* ==================== ADMIN PANEL MODAL ==================== */}
      {isAdminOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-heading"
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setIsAdminOpen(false);
          }}
        >
          <div className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <SlidersHorizontal className="w-4 h-4" />
                </div>
                <h3 id="admin-heading" className="text-base font-bold text-white">
                  Admin Panel
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign out</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsAdminOpen(false)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Close</span>
                </button>
              </div>
            </div>

            {/* Add PDF Section */}
            <div className="rounded-xl bg-slate-950/70 border border-slate-800/90 p-5 space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-2">
                <Plus className="w-4 h-4" />
                <span>Add PDF</span>
              </h4>

              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="admin-pdf-title"
                    className="block text-xs font-semibold text-slate-300 mb-1.5"
                  >
                    PDF title
                  </label>
                  <input
                    id="admin-pdf-title"
                    type="text"
                    value={adminPdfTitle}
                    onChange={(e) => setAdminPdfTitle(e.target.value)}
                    placeholder="Class 10 Trigonometry Formula Sheet"
                    className="w-full px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700/80 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-pdf-url"
                    className="block text-xs font-semibold text-slate-300 mb-1.5"
                  >
                    GitHub PDF link (blob or raw link)
                  </label>
                  <input
                    id="admin-pdf-url"
                    type="url"
                    value={adminPdfUrl}
                    onChange={(e) => setAdminPdfUrl(e.target.value)}
                    placeholder="https://github.com/user/repo/blob/main/chapter1.pdf"
                    className="w-full px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700/80 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleAddPdfLink}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-400 hover:bg-sky-300 text-slate-950 text-xs font-bold transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Save PDF</span>
                  </button>

                  <label
                    htmlFor="admin-local-file"
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors cursor-pointer ${
                      isUploadingPdf ? 'opacity-50 pointer-events-none' : ''
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5 text-amber-400" />
                    <span>
                      {isUploadingPdf ? 'Uploading…' : 'Upload PDF file'}
                    </span>
                  </label>
                  <input
                    id="admin-local-file"
                    type="file"
                    accept="application/pdf"
                    onChange={handleLocalFileUpload}
                    className="hidden"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800/80">
                <div className="text-xs text-slate-400 mb-2.5">Saved PDFs</div>
                {appData.pdfs.length === 0 ? (
                  <p className="text-xs text-slate-500 py-1">
                    No PDFs added yet.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {appData.pdfs.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs"
                      >
                        <span
                          title={p.title}
                          className="text-slate-200 font-medium truncate"
                        >
                          {p.title}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPdfToDelete(p)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-500 hover:bg-rose-600 text-white font-semibold transition-colors cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Delete</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* School Branding Section */}
            <div className="rounded-xl bg-slate-950/70 border border-slate-800/90 p-5 space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-2">
                <School className="w-4 h-4" />
                <span>School branding</span>
              </h4>

              <div className="flex items-center gap-4">
                <img
                  src={adminLogoPreview || DEFAULT_LOGO}
                  alt="Logo preview"
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-full object-contain bg-white p-0.5 border-2 border-sky-400 shrink-0"
                />
                <label
                  htmlFor="admin-logo-input"
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-sky-400" />
                  <span>Upload new logo</span>
                </label>
                <input
                  id="admin-logo-input"
                  type="file"
                  accept="image/*"
                  onChange={handleLogoFileChange}
                  className="hidden"
                />
              </div>

              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="admin-school-input"
                    className="block text-xs font-semibold text-slate-300 mb-1.5"
                  >
                    School name
                  </label>
                  <input
                    id="admin-school-input"
                    type="text"
                    value={adminSchoolInput}
                    onChange={(e) => setAdminSchoolInput(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700/80 text-sm text-slate-100 focus:outline-none focus:border-sky-400"
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-teacher-input"
                    className="block text-xs font-semibold text-slate-300 mb-1.5"
                  >
                    Subject teacher
                  </label>
                  <input
                    id="admin-teacher-input"
                    type="text"
                    value={adminTeacherInput}
                    onChange={(e) => setAdminTeacherInput(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700/80 text-sm text-slate-100 focus:outline-none focus:border-sky-400"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleSaveBranding}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-400 hover:bg-sky-300 text-slate-950 text-xs font-bold transition-colors cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Save branding</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TOAST NOTIFICATIONS ==================== */}
      <div
        aria-live="polite"
        className="fixed left-1/2 bottom-6 -translate-x-1/2 z-[100] flex flex-col gap-2 w-[calc(100%-32px)] max-w-sm pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-950/95 border shadow-2xl text-xs font-medium pointer-events-auto ${
              t.type === 'error'
                ? 'border-rose-500/40 text-rose-200'
                : 'border-emerald-500/40 text-emerald-200'
            }`}
          >
            {t.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
