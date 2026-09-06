import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 18): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

export const Icon = {
  Logo: ({ size = 22, ...p }: P) => (
    <svg {...base(size)} {...p} strokeWidth={0} fill="currentColor">
      <path d="M12 3 3.5 19h17L12 3zm0 4.6 5.1 9.6H6.9L12 7.6z" />
    </svg>
  ),
  Plus: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M12 5v14M5 12h14" /></svg>
  ),
  Bell: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg>
  ),
  Walk: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><circle cx="13" cy="4" r="1.6" /><path d="m9 22 3-8 3 3v5M7 12l3-3 3 1 3 3M10 9l-1 4-3 2" /></svg>
  ),
  Orbit: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M3 12h2M19 12h2M12 3v2M12 19v2" /><circle cx="12" cy="12" r="4" /><path d="M4.5 7.5a9 9 0 0 1 15 0M19.5 16.5a9 9 0 0 1-15 0" /></svg>
  ),
  Ruler: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="m3 17 14-14 4 4L7 21zM8 12l2 2M11 9l2 2M14 6l2 2" /></svg>
  ),
  Sofa: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3z" /></svg>
  ),
  Share: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3M8 7l4-4 4 4" /></svg>
  ),
  Check: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="m5 12 5 5L20 7" /></svg>
  ),
  X: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>
  ),
  ArrowRight: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  ),
  ArrowLeft: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
  ),
  Door: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17M3 21h18" /><circle cx="15" cy="12" r="0.8" fill="currentColor" /></svg>
  ),
  Camera: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.2" /></svg>
  ),
  Upload: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>
  ),
  Sparkles: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" /></svg>
  ),
  Eye: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
  ),
  EyeOff: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M3 3l18 18M10.6 6.3A11 11 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.7M6.6 6.6A16 16 0 0 0 2 12s3.5 6 10 6a10 10 0 0 0 4-.8M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
  ),
  Layers: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5" /></svg>
  ),
  Grid: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></svg>
  ),
  Settings: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
  ),
  ChevronDown: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="m6 9 6 6 6-6" /></svg>
  ),
  ChevronRight: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="m9 6 6 6-6 6" /></svg>
  ),
  Copy: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></svg>
  ),
  Download: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></svg>
  ),
  Users: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4.5-6.2" /></svg>
  ),
  Info: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
  ),
  Warning: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M12 3 2.5 20h19L12 3zM12 10v4M12 17h.01" /></svg>
  ),
  Clock: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  ),
  Trash: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
  ),
  Rotate: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" /></svg>
  ),
  Home: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>
  ),
  Play: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M7 4v16l13-8z" /></svg>
  ),
  Fullscreen: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>
  ),
  Link: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" /></svg>
  ),
  Cursor: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p} fill="currentColor" strokeWidth={0}><path d="M5 3l14 8-6 1.5L10 19z" /></svg>
  ),
  Sun: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
  ),
  Zap: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
  ),
  Chart: ({ size, ...p }: P) => (
    <svg {...base(size)} {...p}><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></svg>
  ),
};
