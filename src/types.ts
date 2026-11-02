/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const SUPABASE_URL = 'https://vykukjlpjbbxinvpowxq.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5a3VramxwamJieGludnBvd3hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2MTgwNTEsImV4cCI6MjEwOTE5NDA1MX0.R70W9nNdlngZr0bwnX93tjXy5TarzK4udmGg7gkrT5c';
export const ADMIN_PASSWORD = 'vcs';
export const BUCKET = 'math-pdfs';
export const CACHE_KEY = 'ajitSirSupabaseCache';
export const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;
export const MAX_CANVAS_PX = 16000000;
export const OLD_NAME = 'ADARSH VIDYA MANDIR';

export const DEFAULT_LOGO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="100%" stop-color="#1e3a8a"/>
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="56" fill="url(#g)" stroke="#f59e0b" stroke-width="4"/>
      <circle cx="60" cy="60" r="47" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>
      <text x="60" y="56" font-family="Georgia,serif" font-size="28" font-weight="bold" fill="#f8fafc" text-anchor="middle">π ∑</text>
      <text x="60" y="79" font-family="sans-serif" font-size="11" font-weight="bold" letter-spacing="1.5" fill="#fbbf24" text-anchor="middle">MATH DEPT</text>
    </svg>`
  );

export interface PdfItem {
  id: string;
  title: string;
  url: string;
  path?: string;
}

export interface PortalData {
  schoolName: string;
  teacherName: string;
  logoUrl: string;
  pdfs: PdfItem[];
}

export interface ToastMsg {
  id: string;
  message: string;
  type: 'success' | 'error';
}

export type ToolType = 'read' | 'pen' | 'hl' | 'text' | 'eraser';

export interface StrokeAnnotation {
  t: 'pen' | 'hl';
  c: string;
  w: number;
  p: [number, number][];
  y0?: number;
}

export interface TextAnnotation {
  t: 'text';
  c: string;
  s: number;
  x: number;
  y: number;
  v: string;
}

export type AnnotationItem = StrokeAnnotation | TextAnnotation;

export interface HistoryRecord {
  k: 'add' | 'erase' | 'clear';
  n?: number;
  item?: AnnotationItem;
  rec?: { n: number; item: AnnotationItem; i: number }[];
  snap?: Record<string, AnnotationItem[]>;
}

export const DEFAULTS: PortalData = {
  schoolName: 'Sri Ramakrishna Sarada Ashrama Vivekananda Central School',
  teacherName: 'Ajit Sir',
  logoUrl: DEFAULT_LOGO,
  pdfs: [],
};

export const SWATCH_COLORS = [
  { hex: '#ef4444', label: 'Crimson Red' },
  { hex: '#2563eb', label: 'Royal Blue' },
  { hex: '#16a34a', label: 'Emerald Green' },
  { hex: '#facc15', label: 'Amber Yellow' },
  { hex: '#111827', label: 'Obsidian Ink' },
];

export const WIDTH_MAP = { pen: 0.004, hl: 0.022 };

declare global {
  interface Window {
    supabase?: {
      createClient: (url: string, key: string) => any;
    };
    pdfjsLib?: any;
  }
}

export function normalizePdfUrl(input: string): string {
  const u = input.trim();
  // Convert Google Drive view links to direct download/stream links if pasted
  const driveMatch = u.match(/^https?:\/\/drive\.google\.com\/file\/d\/([^/]+)\//i);
  if (driveMatch) {
    return `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
  }
  let m = u.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+?)(?:\?.*)?$/i
  );
  if (!m) {
    m = u.match(
      /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+?)(?:\?.*)?$/i
    );
  }
  if (m) return `https://cdn.jsdelivr.net/gh/${m[1]}/${m[2]}@${m[3]}/${m[4]}`;
  return u;
}

export function getCandidatePdfUrls(rawUrl: string): string[] {
  const primary = normalizePdfUrl(rawUrl);
  const candidates = [primary];

  // If jsDelivr hits a 20MB limit or branch issue on GitHub links, fall back to raw.githubusercontent.com
  const jsdMatch = primary.match(
    /^https:\/\/cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^@]+)@([^/]+)\/(.+)$/i
  );
  if (jsdMatch) {
    candidates.push(
      `https://raw.githubusercontent.com/${jsdMatch[1]}/${jsdMatch[2]}/${jsdMatch[3]}/${jsdMatch[4]}`
    );
  }

  if (rawUrl && !candidates.includes(rawUrl)) {
    candidates.push(rawUrl);
  }
  return candidates;
}

export function shrinkImage(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r);
      c.height = Math.round(img.height * r);
      const ctx = c.getContext('2d');
      if (ctx) ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Invalid image'));
    };
    img.src = url;
  });
}

let supabasePromise: Promise<any> | null = null;
export function ensureSupabaseClient(): Promise<any> {
  if (window.supabase) {
    return Promise.resolve(
      window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    );
  }
  if (!supabasePromise) {
    supabasePromise = new Promise((resolve) => {
      let attempts = 0;
      const check = () => {
        if (window.supabase) {
          resolve(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
          return;
        }
        attempts++;
        if (attempts < 35) {
          setTimeout(check, 100);
        } else {
          // Dynamically inject script if CDN script tag was blocked or slow
          const s = document.createElement('script');
          s.src =
            'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
          s.onload = () => {
            if (window.supabase) {
              resolve(
                window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
              );
            } else {
              resolve(null);
            }
          };
          s.onerror = () => resolve(null);
          document.head.appendChild(s);
        }
      };
      check();
    });
  }
  return supabasePromise;
}

let pdfJsPromise: Promise<any> | null = null;
let workerBlobUrl: string | null = null;

export async function loadPdfJs(): Promise<any> {
  if (!pdfJsPromise) {
    pdfJsPromise = new Promise((resolve, reject) => {
      if (window.pdfjsLib) {
        resolve(window.pdfjsLib);
        return;
      }
      const s = document.createElement('script');
      s.src = PDFJS_CDN + 'pdf.min.js';
      s.crossOrigin = 'anonymous';
      s.onload = () => {
        if (window.pdfjsLib) {
          resolve(window.pdfjsLib);
        } else {
          pdfJsPromise = null;
          reject(new Error('PDF engine loaded but initialized empty.'));
        }
      };
      s.onerror = () => {
        pdfJsPromise = null;
        reject(new Error('Could not load the PDF engine. Check your connection.'));
      };
      document.head.appendChild(s);
    });
  }

  const lib = await pdfJsPromise;

  // Create a same-origin Blob worker wrapper so cross-origin iframe security never blocks the Web Worker
  if (!workerBlobUrl) {
    try {
      const workerCode = `importScripts("${PDFJS_CDN}pdf.worker.min.js");`;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      workerBlobUrl = URL.createObjectURL(blob);
      lib.GlobalWorkerOptions.workerSrc = workerBlobUrl;
    } catch (_) {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_CDN + 'pdf.worker.min.js';
    }
  }

  return lib;
}
