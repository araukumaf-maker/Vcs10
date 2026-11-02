/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowLeft,
  PenTool,
  Highlighter,
  Type,
  Eraser,
  Undo2,
  Redo2,
  Hand,
  ZoomIn,
  ZoomOut,
  Download,
  FileText,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import {
  PdfItem,
  ToolType,
  StrokeAnnotation,
  AnnotationItem,
  HistoryRecord,
  SWATCH_COLORS,
  WIDTH_MAP,
  ZOOM_MIN,
  ZOOM_MAX,
  MAX_CANVAS_PX,
  PDFJS_CDN,
  loadPdfJs,
  getCandidatePdfUrls,
} from './types';

interface PdfViewerProps {
  item: PdfItem;
  onClose: () => void;
  addToast: (msg: string, type?: 'success' | 'error') => void;
}

export default function PdfViewer({ item, onClose, addToast }: PdfViewerProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [loadProgress, setLoadProgress] = useState(0);
  const [viewerStatus, setViewerStatus] = useState<{
    type: 'loading' | 'error' | null;
    message?: string;
  }>({ type: 'loading' });
  const [zoomBadgeVisible, setZoomBadgeVisible] = useState(false);
  const [zoomBadgeValue, setZoomBadgeValue] = useState(1);
  const [isAnnPanelOpen, setIsAnnPanelOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolType>('read');
  const [toolColors, setToolColors] = useState<{
    pen: string;
    hl: string;
    text: string;
  }>({
    pen: '#ef4444',
    hl: '#facc15',
    text: '#2563eb',
  });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const [textPromptModal, setTextPromptModal] = useState<{
    open: boolean;
    pageNum: number;
    x: number;
    y: number;
    ov: HTMLCanvasElement | null;
    value: string;
  }>({ open: false, pageNum: 1, x: 0.5, y: 0.5, ov: null, value: '' });
  const [confirmClearModal, setConfirmClearModal] = useState(false);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const viewerStateRef = useRef<{
    doc: any;
    token: number;
    zoom: number;
    scale: number;
    base: any;
    renderIO: IntersectionObserver | null;
    spyIO: IntersectionObserver | null;
    fitW: number;
  }>({
    doc: null,
    token: 0,
    zoom: 1,
    scale: 1,
    base: null,
    renderIO: null,
    spyIO: null,
    fitW: 0,
  });

  const annStateRef = useRef<{
    tool: ToolType;
    col: { pen: string; hl: string; text: string };
    data: Record<string, AnnotationItem[]>;
    key: string;
    hist: HistoryRecord[];
    redo: HistoryRecord[];
    pts: Map<number, { x: number; y: number }>;
    abort: (() => void) | null;
  }>({
    tool: 'read',
    col: { pen: '#ef4444', hl: '#facc15', text: '#2563eb' },
    data: {},
    key: '',
    hist: [],
    redo: [],
    pts: new Map(),
    abort: null,
  });

  const pinchRef = useRef<{
    d0: number;
    zoom0: number;
    k: number;
    mid: { x: number; y: number };
    ox: number;
    oy: number;
  } | null>(null);

  const rebuildTimerRef = useRef<number | undefined>(undefined);
  const badgeTimerRef = useRef<number | undefined>(undefined);

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(annStateRef.current.hist.length > 0);
    setCanRedo(annStateRef.current.redo.length > 0);
  }, []);

  const saveAnnotationsToStorage = useCallback(() => {
    try {
      localStorage.setItem(
        annStateRef.current.key,
        JSON.stringify(annStateRef.current.data)
      );
    } catch (_) {
      addToast('Storage is full. Annotations could not be saved.', 'error');
    }
  }, [addToast]);

  const drawOverlayCanvas = useCallback(
    (ov: HTMLCanvasElement, pageNum: number, live?: StrokeAnnotation | null) => {
      const c = ov.getContext('2d');
      if (!c) return;
      const W = ov.width;
      const H = ov.height;
      c.clearRect(0, 0, W, H);
      const pageItems = annStateRef.current.data[pageNum] || [];
      const allItems = live ? [...pageItems, live] : pageItems;

      for (const a of allItems) {
        if (a.t === 'text') {
          c.fillStyle = a.c;
          c.font = `600 ${a.s * W}px "Plus Jakarta Sans", "Segoe UI", sans-serif`;
          c.textBaseline = 'top';
          c.fillText(a.v, a.x * W, a.y * H);
          continue;
        }
        const p = a.p;
        if (!p || !p.length) continue;
        c.strokeStyle = a.c;
        c.lineWidth = a.w * W;
        c.lineJoin = 'round';
        c.lineCap = a.t === 'hl' ? 'butt' : 'round';
        c.globalAlpha = a.t === 'hl' ? 0.35 : 1;
        c.beginPath();
        c.moveTo(p[0][0] * W, p[0][1] * H);
        if (p.length === 1) {
          c.lineTo(p[0][0] * W + 0.5, p[0][1] * H);
        } else if (p.length === 2) {
          c.lineTo(p[1][0] * W, p[1][1] * H);
        } else {
          for (let i = 1; i < p.length - 1; i++) {
            c.quadraticCurveTo(
              p[i][0] * W,
              p[i][1] * H,
              ((p[i][0] + p[i + 1][0]) / 2) * W,
              ((p[i][1] + p[i + 1][1]) / 2) * H
            );
          }
          const l = p[p.length - 1];
          c.lineTo(l[0] * W, l[1] * H);
        }
        c.stroke();
        c.globalAlpha = 1;
      }
    },
    []
  );

  const refreshAllOverlays = useCallback(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current
      .querySelectorAll<HTMLCanvasElement>('.ann-ov')
      .forEach((ov) => {
        const n = Number(ov.parentElement?.dataset.n || 1);
        drawOverlayCanvas(ov, n);
      });
  }, [drawOverlayCanvas]);

  const pushHistory = useCallback(
    (rec: HistoryRecord) => {
      const AN = annStateRef.current;
      AN.hist.push(rec);
      AN.redo = [];
      saveAnnotationsToStorage();
      syncHistoryFlags();
    },
    [saveAnnotationsToStorage, syncHistoryFlags]
  );

  const addAnnotationItem = useCallback(
    (pageNum: number, ann: AnnotationItem) => {
      const AN = annStateRef.current;
      if (!AN.data[pageNum]) AN.data[pageNum] = [];
      AN.data[pageNum].push(ann);
      pushHistory({ k: 'add', n: pageNum, item: ann });
    },
    [pushHistory]
  );

  const eraseAtPoint = useCallback(
    (
      pageNum: number,
      x: number,
      y: number,
      ov: HTMLCanvasElement,
      rec: { n: number; item: AnnotationItem; i: number }[]
    ) => {
      const AN = annStateRef.current;
      const arr = AN.data[pageNum];
      if (!arr || !arr.length) return false;
      const W = ov.width;
      const H = ov.height;
      const rad = 0.025 * W;
      const px = x * W;
      const py = y * H;
      let hit = false;
      for (let i = arr.length - 1; i >= 0; i--) {
        const a = arr[i];
        let gone = false;
        if (a.t === 'text') {
          const w = a.v.length * a.s * W * 0.55;
          gone =
            px >= a.x * W - rad &&
            px <= a.x * W + w + rad &&
            py >= a.y * H - rad &&
            py <= a.y * H + a.s * W + rad;
        } else {
          gone = a.p.some(
            ([qx, qy]) => Math.hypot(qx * W - px, qy * H - py) < rad
          );
        }
        if (gone) {
          arr.splice(i, 1);
          rec.push({ n: pageNum, item: a, i });
          hit = true;
        }
      }
      if (hit) drawOverlayCanvas(ov, pageNum);
      return hit;
    },
    [drawOverlayCanvas]
  );

  const handleUndo = useCallback(() => {
    const AN = annStateRef.current;
    const a = AN.hist.pop();
    if (!a) return;
    if (a.k === 'add' && a.n !== undefined && a.item) {
      const arr = AN.data[a.n] || [];
      const idx = arr.indexOf(a.item);
      if (idx >= 0) arr.splice(idx, 1);
    } else if (a.k === 'erase' && a.rec) {
      for (let j = a.rec.length - 1; j >= 0; j--) {
        const r = a.rec[j];
        if (!AN.data[r.n]) AN.data[r.n] = [];
        AN.data[r.n].splice(r.i, 0, r.item);
      }
    } else if (a.k === 'clear' && a.snap) {
      AN.data = {};
      for (const k in a.snap) {
        AN.data[k] = a.snap[k].slice();
      }
    }
    AN.redo.push(a);
    saveAnnotationsToStorage();
    refreshAllOverlays();
    syncHistoryFlags();
  }, [refreshAllOverlays, saveAnnotationsToStorage, syncHistoryFlags]);

  const handleRedo = useCallback(() => {
    const AN = annStateRef.current;
    const a = AN.redo.pop();
    if (!a) return;
    if (a.k === 'add' && a.n !== undefined && a.item) {
      if (!AN.data[a.n]) AN.data[a.n] = [];
      AN.data[a.n].push(a.item);
    } else if (a.k === 'erase' && a.rec) {
      a.rec.forEach((r) => {
        const arr = AN.data[r.n] || [];
        const idx = arr.indexOf(r.item);
        if (idx >= 0) arr.splice(idx, 1);
      });
    } else if (a.k === 'clear') {
      AN.data = {};
    }
    AN.hist.push(a);
    saveAnnotationsToStorage();
    refreshAllOverlays();
    syncHistoryFlags();
  }, [refreshAllOverlays, saveAnnotationsToStorage, syncHistoryFlags]);

  const makeOverlayCanvas = useCallback(
    (pageNum: number, w: number, h: number) => {
      const ov = document.createElement('canvas');
      ov.className = 'ann-ov';
      ov.width = w;
      ov.height = h;
      drawOverlayCanvas(ov, pageNum);

      let cur:
        | {
            erase?: false;
            t: 'pen' | 'hl';
            c: string;
            w: number;
            p: [number, number][];
            y0: number;
          }
        | {
            erase: true;
            rec: { n: number; item: AnnotationItem; i: number }[];
          }
        | null = null;
      let raf = 0;

      const pos = (e: PointerEvent): [number, number] => {
        const r = ov.getBoundingClientRect();
        return [
          +((e.clientX - r.left) / r.width).toFixed(4),
          +((e.clientY - r.top) / r.height).toFixed(4),
        ];
      };

      const sched = () => {
        if (!raf) {
          raf = requestAnimationFrame(() => {
            raf = 0;
            if (cur && !cur.erase) {
              drawOverlayCanvas(ov, pageNum, cur);
            }
          });
        }
      };

      const abort = () => {
        if (!cur) return;
        if (cur.erase && cur.rec.length) {
          pushHistory({ k: 'erase', rec: cur.rec });
        }
        cur = null;
        drawOverlayCanvas(ov, pageNum);
      };

      ov.addEventListener('pointerdown', (e: PointerEvent) => {
        const AN = annStateRef.current;
        if (AN.tool === 'read') return;
        if (e.pointerType === 'touch' && AN.pts.size >= 1) return;
        e.preventDefault();
        const [x, y] = pos(e);

        if (AN.tool === 'text') {
          setTextPromptModal({
            open: true,
            pageNum,
            x,
            y,
            ov,
            value: '',
          });
          return;
        }

        try {
          ov.setPointerCapture(e.pointerId);
        } catch (_) {}
        AN.abort = abort;

        if (AN.tool === 'eraser') {
          cur = { erase: true, rec: [] };
          eraseAtPoint(pageNum, x, y, ov, cur.rec);
          return;
        }

        const t = AN.tool === 'hl' ? 'hl' : 'pen';
        cur = {
          t,
          c: AN.col[t],
          w: WIDTH_MAP[t],
          p: [[x, y]],
          y0: y,
        };
        sched();
      });

      ov.addEventListener('pointermove', (e: PointerEvent) => {
        if (!cur) return;
        const coalesced =
          (e as any).getCoalescedEvents &&
          (e as any).getCoalescedEvents().length
            ? (e as any).getCoalescedEvents()
            : [e];
        for (const ev of coalesced) {
          const [x, y] = pos(ev);
          if (cur.erase) {
            eraseAtPoint(pageNum, x, y, ov, cur.rec);
            continue;
          }
          const last = cur.p[cur.p.length - 1];
          const yy = cur.t === 'hl' ? cur.y0 : y;
          if (Math.abs(last[0] - x) + Math.abs(last[1] - yy) < 0.0008) continue;
          cur.p.push([x, yy]);
        }
        sched();
      });

      const end = () => {
        if (!cur) return;
        if (cur.erase) {
          if (cur.rec.length) pushHistory({ k: 'erase', rec: cur.rec });
        } else {
          const stroke: StrokeAnnotation = {
            t: cur.t,
            c: cur.c,
            w: cur.w,
            p: cur.p,
          };
          addAnnotationItem(pageNum, stroke);
        }
        cur = null;
        drawOverlayCanvas(ov, pageNum);
      };

      ov.addEventListener('pointerup', end);
      ov.addEventListener('pointercancel', end);
      return ov;
    },
    [addAnnotationItem, drawOverlayCanvas, eraseAtPoint, pushHistory]
  );

  const teardownViewer = useCallback(() => {
    const V = viewerStateRef.current;
    V.token++;
    if (V.renderIO) V.renderIO.disconnect();
    if (V.spyIO) V.spyIO.disconnect();
    V.renderIO = null;
    V.spyIO = null;
    if (V.doc) {
      try {
        V.doc.destroy();
      } catch (_) {}
      V.doc = null;
    }
  }, []);

  const releaseSlot = useCallback((slot: any) => {
    slot._r = (slot._r || 0) + 1;
    if (slot._task) {
      try {
        slot._task.cancel();
      } catch (_) {}
      slot._task = null;
    }
    slot.replaceChildren();
    slot.dataset.state = '';
  }, []);

  const renderSlot = useCallback(
    async (slot: any) => {
      if (slot.dataset.state) return;
      slot.dataset.state = 'busy';
      const V = viewerStateRef.current;
      const id = (slot._r = (slot._r || 0) + 1);
      const token = V.token;
      try {
        const pageNum = Number(slot.dataset.n);
        const page = await V.doc.getPage(pageNum);
        if (id !== slot._r || token !== V.token) return;
        const vp = page.getViewport({ scale: V.scale });
        let out = Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 2.5);
        out = Math.min(out, Math.sqrt(MAX_CANVAS_PX / (vp.width * vp.height)));

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width * out);
        canvas.height = Math.floor(vp.height * out);
        canvas.style.width = '100%';
        canvas.style.height = '100%';

        slot.style.width = Math.floor(vp.width) + 'px';
        slot.style.height = Math.floor(vp.height) + 'px';

        const task = page.render({
          canvasContext: canvas.getContext('2d'),
          viewport: vp,
          transform: [out, 0, 0, out, 0, 0],
        });
        slot._task = task;
        await task.promise;
        if (id !== slot._r || token !== V.token) return;
        slot._task = null;
        slot.replaceChildren(
          canvas,
          makeOverlayCanvas(pageNum, canvas.width, canvas.height)
        );
        slot.dataset.state = 'done';
      } catch (err: any) {
        if (err && err.name === 'RenderingCancelledException') return;
        if (id === slot._r) slot.dataset.state = '';
        console.error(err);
      }
    },
    [makeOverlayCanvas]
  );

  const buildSlots = useCallback(() => {
    const V = viewerStateRef.current;
    const scroller = scrollerRef.current;
    if (!V.doc || !scroller) return;

    const keep = scroller.scrollHeight
      ? scroller.scrollTop / scroller.scrollHeight
      : 0;
    if (V.renderIO) V.renderIO.disconnect();
    if (V.spyIO) V.spyIO.disconnect();
    scroller.innerHTML = '';

    const availableWidth = Math.max(280, scroller.clientWidth - 24);
    V.fitW = Math.min(availableWidth, 1000);
    V.scale = (V.fitW / V.base.width) * V.zoom;
    setZoomLevel(V.zoom);

    const w = Math.floor(V.base.width * V.scale);
    const h = Math.floor(V.base.height * V.scale);
    const pages = document.createElement('div');
    pages.className =
      'pages flex flex-col items-center gap-5 w-max min-w-full shrink-0 origin-top-left';
    pages.id = 'pages';

    const slots: HTMLDivElement[] = [];
    for (let n = 1; n <= V.doc.numPages; n++) {
      const s = document.createElement('div');
      s.className = 'page-slot';
      s.id = 'pdf-page-' + n;
      s.dataset.n = String(n);
      s.dataset.state = '';
      s.style.width = w + 'px';
      s.style.height = h + 'px';
      pages.appendChild(s);
      slots.push(s);
    }

    scroller.appendChild(pages);
    scroller.scrollTop = keep * scroller.scrollHeight;

    V.renderIO = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) =>
          en.isIntersecting
            ? renderSlot(en.target)
            : releaseSlot(en.target)
        );
      },
      { root: scroller, rootMargin: '900px 0px' }
    );

    V.spyIO = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            const pNum = Number((en.target as HTMLElement).dataset.n || 1);
            setCurrentPage(pNum);
          }
        });
      },
      { root: scroller, rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );

    slots.forEach((s) => {
      V.renderIO?.observe(s);
      V.spyIO?.observe(s);
    });
  }, [releaseSlot, renderSlot]);

  const showTemporaryZoomBadge = useCallback((z: number) => {
    setZoomBadgeValue(z);
    setZoomBadgeVisible(true);
    window.clearTimeout(badgeTimerRef.current);
    badgeTimerRef.current = window.setTimeout(() => {
      setZoomBadgeVisible(false);
    }, 950);
  }, []);

  const scheduleRebuild = useCallback(() => {
    window.clearTimeout(rebuildTimerRef.current);
    rebuildTimerRef.current = window.setTimeout(() => {
      viewerStateRef.current.token++;
      buildSlots();
    }, 150);
  }, [buildSlots]);

  const clampZoom = (z: number) =>
    Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100));

  const updateZoom = useCallback(
    (nextZoom: number) => {
      const V = viewerStateRef.current;
      if (!V.doc) return;
      V.zoom = clampZoom(nextZoom);
      setZoomLevel(V.zoom);
      showTemporaryZoomBadge(V.zoom);
      scheduleRebuild();
    },
    [scheduleRebuild, showTemporaryZoomBadge]
  );

  const loadDocument = useCallback(async () => {
    setCurrentPage(1);
    setTotalPages(0);
    setZoomLevel(1);
    setLoadProgress(0);
    setViewerStatus({ type: 'loading' });
    teardownViewer();

    const AN = annStateRef.current;
    AN.key = 'pdfAnn:' + item.id;
    AN.hist = [];
    AN.redo = [];
    AN.pts.clear();
    AN.abort = null;
    try {
      const raw = localStorage.getItem(AN.key);
      AN.data = raw ? JSON.parse(raw) : {};
    } catch (_) {
      AN.data = {};
    }
    syncHistoryFlags();

    const V = viewerStateRef.current;
    const token = ++V.token;

    try {
      const lib = await loadPdfJs();
      const candidateUrls = getCandidatePdfUrls(item.url);
      let loadedDoc: any = null;
      let lastErr: any = null;

      for (const candidateUrl of candidateUrls) {
        if (token !== V.token) return;
        try {
          const task = lib.getDocument({
            url: candidateUrl,
            cMapUrl: PDFJS_CDN + 'cmaps/',
            cMapPacked: true,
            disableAutoFetch: true,
            rangeChunkSize: 262144,
          });

          task.onProgress = (p: { loaded: number; total: number }) => {
            if (p.total && token === V.token) {
              setLoadProgress(Math.min(99, Math.round((p.loaded / p.total) * 100)));
            }
          };

          loadedDoc = await task.promise;
          if (loadedDoc) break;
        } catch (err) {
          lastErr = err;
          // Try fetching without range requests if the host/CDN rejected range headers
          try {
            const fallbackTask = lib.getDocument({
              url: candidateUrl,
              cMapUrl: PDFJS_CDN + 'cmaps/',
              cMapPacked: true,
              disableRange: true,
              disableStream: true,
            });
            loadedDoc = await fallbackTask.promise;
            if (loadedDoc) break;
          } catch (err2) {
            lastErr = err2;
          }
        }
      }

      if (!loadedDoc) {
        throw lastErr || new Error('Could not open this PDF.');
      }

      if (token !== V.token) {
        loadedDoc.destroy();
        return;
      }

      V.doc = loadedDoc;
      V.zoom = 1;
      const first = await loadedDoc.getPage(1);
      V.base = first.getViewport({ scale: 1 });
      setTotalPages(loadedDoc.numPages);
      setLoadProgress(0);
      setViewerStatus({ type: null });

      requestAnimationFrame(() => {
        buildSlots();
      });
    } catch (err: any) {
      if (token !== V.token) return;
      setLoadProgress(0);
      setViewerStatus({
        type: 'error',
        message: err?.message || 'Unable to load this PDF file.',
      });
    }
  }, [buildSlots, item.id, item.url, syncHistoryFlags, teardownViewer]);

  useEffect(() => {
    loadDocument();
    return () => {
      teardownViewer();
    };
  }, [loadDocument, teardownViewer]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const PINCH_DEADZONE = 0.03;
    const tDist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const tMid = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    });

    const startPinch = (touches: TouchList) => {
      const pages = document.getElementById('pages');
      const V = viewerStateRef.current;
      if (!V.doc || !pages) return;
      window.clearTimeout(rebuildTimerRef.current);
      const mid = tMid(touches);
      const r = pages.getBoundingClientRect();
      pinchRef.current = {
        d0: tDist(touches) || 1,
        zoom0: V.zoom,
        k: 1,
        mid,
        ox: mid.x - r.left,
        oy: mid.y - r.top,
      };
      pages.style.transformOrigin = `${pinchRef.current.ox}px ${pinchRef.current.oy}px`;
    };

    const movePinch = (touches: TouchList) => {
      const pages = document.getElementById('pages');
      const p = pinchRef.current;
      if (!p || !pages) return;
      let k = tDist(touches) / p.d0;
      k = Math.max(ZOOM_MIN / p.zoom0, Math.min(ZOOM_MAX / p.zoom0, k));
      p.k = k;
      p.mid = tMid(touches);
      if (Math.abs(k - 1) > PINCH_DEADZONE) {
        pages.style.transform = `scale(${k})`;
        showTemporaryZoomBadge(p.zoom0 * k);
      } else {
        pages.style.transform = '';
      }
    };

    const endPinch = () => {
      const p = pinchRef.current;
      pinchRef.current = null;
      const pages = document.getElementById('pages');
      const V = viewerStateRef.current;
      if (!p || !pages) return;
      pages.style.transform = '';
      const z = clampZoom(p.zoom0 * p.k);
      if (Math.abs(p.k - 1) <= PINCH_DEADZONE || z === V.zoom) {
        setZoomLevel(V.zoom);
        return;
      }
      const ratio = z / V.zoom;
      V.zoom = z;
      V.token++;
      buildSlots();
      const newPages = document.getElementById('pages');
      if (newPages) {
        const nr = newPages.getBoundingClientRect();
        scroller.scrollLeft += nr.left + p.ox * ratio - p.mid.x;
        scroller.scrollTop += nr.top + p.oy * ratio - p.mid.y;
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) startPinch(e.touches);
      else if (e.touches.length > 2 && pinchRef.current) endPinch();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (pinchRef.current && e.touches.length === 2) {
        if (e.cancelable) e.preventDefault();
        movePinch(e.touches);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (pinchRef.current && e.touches.length < 2) endPinch();
    };

    const onWheel = (e: WheelEvent) => {
      const V = viewerStateRef.current;
      if (!e.ctrlKey || !V.doc) return;
      e.preventDefault();
      updateZoom(V.zoom * Math.exp(-e.deltaY * 0.01));
    };

    const pts = annStateRef.current.pts;
    let lastMid: { x: number; y: number } | null = null;
    const calcMid = () => {
      let x = 0;
      let y = 0;
      pts.forEach((pt) => {
        x += pt.x;
        y += pt.y;
      });
      return { x: x / pts.size, y: y / pts.size };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2) {
        if (annStateRef.current.abort) annStateRef.current.abort();
        lastMid = calcMid();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2 && lastMid) {
        const m = calcMid();
        if (!pinchRef.current) {
          scroller.scrollTop -= m.y - lastMid.y;
          scroller.scrollLeft -= m.x - lastMid.x;
        }
        lastMid = m;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pts.delete(e.pointerId);
      lastMid = pts.size >= 2 ? calcMid() : null;
    };

    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: false });
    scroller.addEventListener('touchend', onTouchEnd);
    scroller.addEventListener('touchcancel', onTouchEnd);
    scroller.addEventListener('wheel', onWheel, { passive: false });
    scroller.addEventListener('pointerdown', onPointerDown);
    scroller.addEventListener('pointermove', onPointerMove);
    scroller.addEventListener('pointerup', onPointerUp);
    scroller.addEventListener('pointercancel', onPointerUp);

    let lastW = scroller.clientWidth;
    const onResize = () => {
      if (!viewerStateRef.current.doc) return;
      const w = scroller.clientWidth;
      if (Math.abs(w - lastW) > 40) {
        lastW = w;
        scheduleRebuild();
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('pointerdown', onPointerDown);
      scroller.removeEventListener('pointermove', onPointerMove);
      scroller.removeEventListener('pointerup', onPointerUp);
      scroller.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('resize', onResize);
    };
  }, [buildSlots, scheduleRebuild, showTemporaryZoomBadge, updateZoom]);

  const jumpToPage = (pageNumber: number) => {
    const V = viewerStateRef.current;
    if (!V.doc) return;
    const clamped = Math.max(1, Math.min(V.doc.numPages, pageNumber));
    setCurrentPage(clamped);
    const el = document.getElementById('pdf-page-' + clamped);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const selectAnnotationTool = (tool: ToolType) => {
    annStateRef.current.tool = tool;
    setActiveTool(tool);
  };

  const selectSwatchColor = (hex: string) => {
    const AN = annStateRef.current;
    const currentT = AN.tool;
    const targetTool: 'pen' | 'hl' | 'text' =
      currentT === 'hl' || currentT === 'text' ? currentT : 'pen';
    AN.col[targetTool] = hex;
    setToolColors({ ...AN.col });
    if (currentT === 'read' || currentT === 'eraser') {
      AN.tool = 'pen';
      setActiveTool('pen');
    }
  };

  const toggleAnnotationPanel = (force?: boolean) => {
    setIsAnnPanelOpen((prev) => {
      const next = typeof force === 'boolean' ? force : !prev;
      if (next) {
        if (annStateRef.current.tool === 'read') {
          annStateRef.current.tool = 'pen';
          setActiveTool('pen');
        }
      } else {
        annStateRef.current.tool = 'read';
        setActiveTool('read');
      }
      return next;
    });
  };

  const handleRequestClearAnnotations = () => {
    const AN = annStateRef.current;
    const hasAny = Object.values(AN.data).some((arr) => arr && arr.length > 0);
    if (!hasAny) {
      addToast('No annotations to clear.');
      return;
    }
    setConfirmClearModal(true);
  };

  const executeClearAnnotations = () => {
    const AN = annStateRef.current;
    const snap: Record<string, AnnotationItem[]> = {};
    for (const k in AN.data) {
      snap[k] = AN.data[k].slice();
    }
    AN.data = {};
    pushHistory({ k: 'clear', snap });
    refreshAllOverlays();
    setConfirmClearModal(false);
    addToast('Cleared all annotations on this PDF');
  };

  const handleTextAnnotationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = textPromptModal.value.trim();
    if (val && textPromptModal.ov) {
      addAnnotationItem(textPromptModal.pageNum, {
        t: 'text',
        c: annStateRef.current.col.text,
        s: 0.024,
        x: textPromptModal.x,
        y: textPromptModal.y,
        v: val,
      });
      drawOverlayCanvas(textPromptModal.ov, textPromptModal.pageNum);
    }
    setTextPromptModal((prev) => ({ ...prev, open: false, value: '' }));
  };

  const activeColorForHighlight =
    toolColors[
      activeTool === 'hl' || activeTool === 'text' ? activeTool : 'pen'
    ];

  return (
    <section
      aria-label="PDF viewer"
      className="fixed inset-0 z-40 flex flex-col bg-[#090d16] h-dvh w-screen overflow-hidden"
    >
      {/* Top Loading Progress Bar */}
      {loadProgress > 0 && loadProgress < 100 && (
        <div className="fixed top-0 left-0 right-0 h-1 bg-slate-900 z-50">
          <div
            className="h-full bg-sky-400 transition-all duration-200"
            style={{ width: `${loadProgress}%` }}
          />
        </div>
      )}

      {/* Sleek Reader Header Bar */}
      <div className="h-14 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-3 sm:px-5 flex items-center justify-between gap-3 shrink-0 z-30">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs sm:text-sm font-semibold border border-slate-700 transition-colors cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <div className="min-w-0 hidden sm:block">
            <h2 className="text-sm font-semibold text-slate-100 truncate">
              {item.title}
            </h2>
          </div>
        </div>

        {totalPages > 0 && (
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1 bg-slate-950/90 border border-slate-800 rounded-lg px-2 py-1 text-xs font-mono">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => jumpToPage(currentPage - 1)}
                aria-label="Previous page"
                className="p-1 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-center gap-1 px-1">
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={currentPage}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) jumpToPage(val);
                  }}
                  aria-label="Current page number"
                  className="w-9 text-center bg-transparent text-slate-100 font-semibold focus:outline-none"
                />
                <span className="text-slate-500">/</span>
                <span className="text-slate-400">{totalPages}</span>
              </div>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => jumpToPage(currentPage + 1)}
                aria-label="Next page"
                className="p-1 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1 bg-slate-950/90 border border-slate-800 rounded-lg px-2 py-1 text-xs font-mono">
              <button
                type="button"
                onClick={() => updateZoom(zoomLevel - 0.25)}
                disabled={zoomLevel <= ZOOM_MIN}
                aria-label="Zoom out"
                className="p-1 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => updateZoom(1)}
                title="Reset zoom to 100%"
                className="px-1.5 text-slate-200 hover:text-sky-400 cursor-pointer"
              >
                {Math.round(zoomLevel * 100)}%
              </button>
              <button
                type="button"
                onClick={() => updateZoom(zoomLevel + 0.25)}
                disabled={zoomLevel >= ZOOM_MAX}
                aria-label="Zoom in"
                className="p-1 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            download={`${item.title.replace(/\s+/g, '_')}.pdf`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700/80 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Download</span>
          </a>
        </div>
      </div>

      {/* Floating Zoom Badge */}
      <div
        aria-hidden="true"
        className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-950/90 border border-slate-700 text-slate-100 font-mono text-xs font-bold px-4 py-1.5 rounded-full pointer-events-none shadow-lg transition-opacity duration-200 ${
          zoomBadgeVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {Math.round(zoomBadgeValue * 100)}%
      </div>

      {/* Loading or Error States */}
      {viewerStatus.type === 'loading' && (
        <div className="absolute inset-0 top-14 flex flex-col items-center justify-center bg-[#090d16] z-20 p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 mb-4 animate-pulse">
            <FileText className="w-6 h-6" />
          </div>
          <p className="text-sm font-semibold text-slate-200 mb-1">
            Loading PDF…
          </p>
          <p className="text-xs text-slate-400 font-mono">
            {loadProgress > 0
              ? `${loadProgress}% downloaded`
              : 'Preparing document pages'}
          </p>
        </div>
      )}

      {viewerStatus.type === 'error' && (
        <div className="absolute inset-0 top-14 flex flex-col items-center justify-center bg-[#090d16] z-20 p-6 text-center max-w-md mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-100 mb-1">
            Could not open this PDF
          </h3>
          <p className="text-xs text-slate-400 mb-5">{viewerStatus.message}</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadDocument}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-500 text-slate-950 text-xs font-semibold hover:bg-sky-400 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Try again</span>
            </button>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700 transition-colors"
            >
              <span>Open Direct Link</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}

      {/* Scrollable PDF Pages Container */}
      <div
        ref={scrollerRef}
        className={`flex-1 min-h-0 overflow-auto flex flex-col items-start pt-6 pb-32 px-3 sm:px-6 overscroll-contain touch-pan-x touch-pan-y ${
          activeTool !== 'read' ? 'annotating' : ''
        }`}
      />

      {/* Floating Annotation Toolbar */}
      <div
        role="toolbar"
        aria-label="Annotation tools"
        className={`fixed right-4 bottom-20 z-50 max-w-[calc(100vw-32px)] flex items-center gap-1 p-2 rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-slate-700/90 shadow-2xl overflow-x-auto origin-bottom-right transition-all duration-200 ${
          isAnnPanelOpen
            ? 'opacity-100 scale-100 visible translate-y-0'
            : 'opacity-0 scale-95 invisible translate-y-3 pointer-events-none'
        }`}
      >
        <button
          type="button"
          onClick={() => selectAnnotationTool('read')}
          title="Scroll / read"
          className={`flex flex-col items-center gap-1 min-w-[54px] py-2 px-2 rounded-xl text-[11px] font-semibold transition-all cursor-pointer shrink-0 ${
            activeTool === 'read'
              ? 'bg-sky-400 text-slate-950 shadow-xs'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Hand className="w-4 h-4" />
          <span>Scroll</span>
        </button>

        <button
          type="button"
          onClick={() => selectAnnotationTool('pen')}
          title="Pencil"
          className={`flex flex-col items-center gap-1 min-w-[54px] py-2 px-2 rounded-xl text-[11px] font-semibold transition-all cursor-pointer shrink-0 ${
            activeTool === 'pen'
              ? 'bg-sky-400 text-slate-950 shadow-xs'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <PenTool className="w-4 h-4" />
          <span>Pencil</span>
        </button>

        <button
          type="button"
          onClick={() => selectAnnotationTool('hl')}
          title="Highlight"
          className={`flex flex-col items-center gap-1 min-w-[54px] py-2 px-2 rounded-xl text-[11px] font-semibold transition-all cursor-pointer shrink-0 ${
            activeTool === 'hl'
              ? 'bg-sky-400 text-slate-950 shadow-xs'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Highlighter className="w-4 h-4" />
          <span>Highlight</span>
        </button>

        <button
          type="button"
          onClick={() => selectAnnotationTool('text')}
          title="Text note"
          className={`flex flex-col items-center gap-1 min-w-[54px] py-2 px-2 rounded-xl text-[11px] font-semibold transition-all cursor-pointer shrink-0 ${
            activeTool === 'text'
              ? 'bg-sky-400 text-slate-950 shadow-xs'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Type className="w-4 h-4" />
          <span>Text</span>
        </button>

        <button
          type="button"
          onClick={() => selectAnnotationTool('eraser')}
          title="Eraser"
          className={`flex flex-col items-center gap-1 min-w-[54px] py-2 px-2 rounded-xl text-[11px] font-semibold transition-all cursor-pointer shrink-0 ${
            activeTool === 'eraser'
              ? 'bg-sky-400 text-slate-950 shadow-xs'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Eraser className="w-4 h-4" />
          <span>Eraser</span>
        </button>

        <div className="w-px h-8 bg-slate-700/80 mx-1.5 shrink-0" />

        <div className="flex items-center gap-1.5 px-1 shrink-0">
          {SWATCH_COLORS.map((s) => {
            const isSelected = activeColorForHighlight === s.hex;
            return (
              <button
                key={s.hex}
                type="button"
                onClick={() => selectSwatchColor(s.hex)}
                aria-label={s.label}
                title={s.label}
                style={{ backgroundColor: s.hex }}
                className={`w-6 h-6 rounded-full transition-transform cursor-pointer shrink-0 ${
                  isSelected
                    ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110'
                    : 'opacity-80 hover:opacity-100 border border-white/20'
                }`}
              />
            );
          })}
        </div>

        <div className="w-px h-8 bg-slate-700/80 mx-1.5 shrink-0" />

        <button
          type="button"
          onClick={handleUndo}
          disabled={!canUndo}
          title="Undo"
          className="flex flex-col items-center gap-1 min-w-[48px] py-2 px-2 rounded-xl text-[11px] font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer shrink-0"
        >
          <Undo2 className="w-4 h-4" />
          <span>Undo</span>
        </button>

        <button
          type="button"
          onClick={handleRedo}
          disabled={!canRedo}
          title="Redo"
          className="flex flex-col items-center gap-1 min-w-[48px] py-2 px-2 rounded-xl text-[11px] font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer shrink-0"
        >
          <Redo2 className="w-4 h-4" />
          <span>Redo</span>
        </button>

        <button
          type="button"
          onClick={handleRequestClearAnnotations}
          title="Clear all"
          className="flex flex-col items-center gap-1 min-w-[48px] py-2 px-2 rounded-xl text-[11px] font-semibold text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer shrink-0"
        >
          <Trash2 className="w-4 h-4" />
          <span>Clear</span>
        </button>
      </div>

      {/* Floating Annotation FAB */}
      <button
        type="button"
        onClick={() => toggleAnnotationPanel()}
        aria-expanded={isAnnPanelOpen}
        className={`fixed right-4 bottom-4 z-50 inline-flex items-center gap-2.5 px-5 py-3 rounded-full text-sm font-bold shadow-2xl transition-all cursor-pointer ${
          isAnnPanelOpen
            ? 'bg-slate-900 text-sky-400 ring-2 ring-sky-400'
            : 'bg-sky-400 text-slate-950 hover:bg-sky-300'
        }`}
      >
        {isAnnPanelOpen ? (
          <>
            <X className="w-4 h-4" />
            <span>Close</span>
          </>
        ) : (
          <>
            <PenTool className="w-4 h-4" />
            <span>Annotation</span>
          </>
        )}
      </button>

      {/* Inline Text Note Prompt Modal */}
      {textPromptModal.open && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setTextPromptModal((prev) => ({ ...prev, open: false }));
            }
          }}
        >
          <form
            onSubmit={handleTextAnnotationSubmit}
            className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Type className="w-4 h-4 text-sky-400" />
                <span>Write your note</span>
              </h3>
              <button
                type="button"
                onClick={() =>
                  setTextPromptModal((prev) => ({ ...prev, open: false }))
                }
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              autoFocus
              value={textPromptModal.value}
              onChange={(e) =>
                setTextPromptModal((prev) => ({
                  ...prev,
                  value: e.target.value,
                }))
              }
              placeholder="Type your note..."
              className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400 mb-4"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  setTextPromptModal((prev) => ({ ...prev, open: false }))
                }
                className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-sky-400 text-slate-950 hover:bg-sky-300 cursor-pointer"
              >
                Save Note
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirm Clear Annotations Modal */}
      {confirmClearModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirmClearModal(false);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl">
            <h3 className="text-base font-bold text-slate-100 mb-2">
              Clear all annotations on this PDF?
            </h3>
            <p className="text-xs text-slate-400 mb-5 leading-relaxed">
              This removes all strokes, highlights, and text notes on this PDF. You can still undo immediately using Undo.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmClearModal(false)}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeClearAnnotations}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-rose-500 text-white hover:bg-rose-600 cursor-pointer"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
