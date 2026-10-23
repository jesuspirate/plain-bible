// Icons drawn as solid, simple shapes so they stay clear at any size and
// for tired eyes. They take the colour of the text around them.
type P = { size?: number | string; class?: string }
const svg = (size: number | string = '1em', cls?: string) => ({ viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, class: cls })

/** A ribbon bookmark, like the one sewn into a printed Bible. */
export const BookmarkIcon = ({ size, class: c, filled = true }: P & { filled?: boolean }) => (
  <svg {...svg(size, c)}><path d="M6.5 2.5h11a1.5 1.5 0 0 1 1.5 1.5v18l-7-4.6L5 22V4a1.5 1.5 0 0 1 1.5-1.5z"
    fill={filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
)

/** A page with lines: a note. */
export const NoteIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M4.5 3.5h10.5l4.5 4.5v12.5h-15z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" />
    <path d="M8 12h8M8 16h5.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
)

/** A clock with an arrow turning back: reading history. */
export const HistoryIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M4.6 13.5a7.6 7.6 0 1 0 1.6-6.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
    <path d="M3.5 3.8v4.6h4.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M12 8v4.5l3 2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
)

export const CopyIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><rect x="8.5" y="8.5" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2" />
    <path d="M15.5 5.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
)

export const ShareIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v7A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
)

export const LinkIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
)

/** Two columns side by side: compare versions. */
export const CompareIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><rect x="3" y="4" width="7.5" height="16" rx="1.8" fill="none" stroke="currentColor" stroke-width="2.2" />
    <rect x="13.5" y="4" width="7.5" height="16" rx="1.8" fill="none" stroke="currentColor" stroke-width="2.2" /></svg>
)


/** Two hands pressed together: prayer. */
export const PrayIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}>
    <mask id="pray-thumbs"><rect width="24" height="24" fill="#fff" /><path d="M11.4 13.4 9.6 10.6M12.6 13.4l1.8-2.8" stroke="#000" stroke-width="1" stroke-linecap="round" /></mask>
    <g fill="currentColor" mask="url(#pray-thumbs)">
      <path d="M11.4 2c-.9 0-1.6.7-1.8 1.6L8.1 9.8 4.2 14.5l4.1 3.9 3.1-2.6z" />
      <path d="M12.6 2c.9 0 1.6.7 1.8 1.6l1.5 6.2 3.9 4.7-4.1 3.9-3.1-2.6z" />
    </g>
    <path d="M2.9 16.6 6.4 19.9M21.1 16.6l-3.5 3.3" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" />
  </svg>
)
