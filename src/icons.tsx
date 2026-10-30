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

/** A circular arrow: get the new version. */
export const RefreshIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <path d="M19.8 3.8v4.6h-4.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
)


/** A ring of people with one filled in (you), around the cross: where two
 *  or three gather in his name (Matthew 18:20). Share with your circle. */
export const CircleIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M15.05 3.96A8.6 8.6 0 0 1 18.71 6.62M20.59 12.42A8.6 8.6 0 0 1 19.19 16.71M14.26 20.30A8.6 8.6 0 0 1 9.74 20.30M4.81 16.71A8.6 8.6 0 0 1 3.41 12.42M5.29 6.62A8.6 8.6 0 0 1 8.95 3.96" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    <circle cx="12" cy="3.40" r="2.8" fill="currentColor" />
    <circle cx="20.18" cy="9.34" r="1.8" fill="none" stroke="currentColor" stroke-width="2" />
    <circle cx="17.05" cy="18.96" r="1.8" fill="none" stroke="currentColor" stroke-width="2" />
    <circle cx="6.95" cy="18.96" r="1.8" fill="none" stroke="currentColor" stroke-width="2" />
    <circle cx="3.82" cy="9.34" r="1.8" fill="none" stroke="currentColor" stroke-width="2" />
    <path d="M12 8.6v6.8M9.6 10.9h4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
)

/** A thick ×: close. Drawn, not typed, so it stays bold on every phone. */
export const CloseIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" /></svg>
)

/** A thick ‹: back. */
export const BackIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M15 4.5L7.5 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
)

// Settings rows. Each row has one of these at its left, in the accent colour,
// so the names line up down the whole sheet.
const line = { fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const

/** An open book: the Bible you read. */
export const BookIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M12 6.6C10 5.1 7 4.6 3 5v13.6c4-.4 7 .1 9 1.6 2-1.5 5-2 9-1.6V5c-4-.4-7 .1-9 1.6zM12 6.6v13.6" {...line} /></svg>
)

/** Books standing on a shelf: all the versions. */
export const BooksIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M3.5 4h4v16h-4zM10 6.5h4V20h-4zM15.8 7.8l3.6-1 2.7 12.4-3.6 1z" {...line} /></svg>
)

/** A magnifying glass: search. */
export const SearchIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><circle cx="10.5" cy="10.5" r="6.5" {...line} /><path d="M15.4 15.4l5.1 5.1" {...line} stroke-width="2.8" /></svg>
)

/** A small A and a big A: text size. */
export const TextSizeIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M2.5 19.5l3.6-9 3.6 9M3.8 16.3h4.6M11 19.5l5.3-14 5.3 14M13 14.3h6.6" {...line} /></svg>
)

/** A circle half light, half dark: the theme. */
export const ThemeIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><circle cx="12" cy="12" r="8.5" {...line} /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" /></svg>
)

/** Lines of text: font and layout. */
export const LayoutIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M4 5.5h16M4 10h16M4 14.5h16M4 19h10" {...line} /></svg>
)

/** Into a tray: your data, to bring in or keep. */
export const DataIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M12 3.5v10.5M7.5 9.5l4.5 4.5 4.5-4.5M4 14.5v4A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-4" {...line} /></svg>
)

/** An i in a circle: about. */
export const InfoIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><circle cx="12" cy="12" r="9" {...line} /><path d="M12 11v6" {...line} stroke-width="2.6" /><circle cx="12" cy="7.4" r="1.5" fill="currentColor" /></svg>
)

/** A compass: the guided tour. */
export const CompassIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><circle cx="12" cy="12" r="9" {...line} /><path d="M15.6 8.4l-2 5.2-5.2 2 2-5.2z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /></svg>
)

/** A square with a plus, as Safari draws Add to Home Screen. */
export const AddHomeIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" {...line} /><path d="M12 8v8M8 12h8" {...line} stroke-width="2.6" /></svg>
)

/** A globe: the app's language. */
export const GlobeIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><circle cx="12" cy="12" r="9" {...line} /><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" {...line} /></svg>
)

/** An arrow turning back: back to your own Bible. */
export const ReturnIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M8.5 4.5L4 9l4.5 4.5M4.5 9h10a5.5 5.5 0 0 1 0 11H10" {...line} /></svg>
)

/** A tick in a circle: signed in. */
export const CheckIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><circle cx="12" cy="12" r="9" {...line} /><path d="M7.8 12.4l2.9 2.9 5.6-6" {...line} stroke-width="2.6" /></svg>
)

/** An envelope: email. */
export const MailIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><rect x="3" y="5.5" width="18" height="13" rx="2" {...line} /><path d="M3.8 7l8.2 6 8.2-6" {...line} /></svg>
)

/** A key: a passkey. */
export const KeyIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><circle cx="7.5" cy="12" r="4" {...line} /><path d="M11.5 12h9.5M17.5 12v3.5M20.5 12v2.5" {...line} /></svg>
)

/** A phone: another device. */
export const PhoneIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" {...line} /><path d="M10.5 18h3" {...line} /></svg>
)

/** Out through a door: sign out. */
export const SignOutIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M13.5 4.5h-7A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5h7M10.5 12H21M17 8l4 4-4 4" {...line} /></svg>
)

/** A bin: delete. */
export const TrashIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M4 6.5h16M9.5 6.5v-2h5v2M6.5 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-13M10 10.5v6M14 10.5v6" {...line} /></svg>
)

/** A marker pen over a line: highlights. */
export const HighlightIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M15 3.8l5.2 5.2-8.6 8.6H6.4v-5.2zM12.3 6.5l5.2 5.2M3.5 21h10" {...line} /></svg>
)

/** A pencil: edit. */
export const EditIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M16.2 4.2l3.6 3.6L8.5 19.1 4 20l.9-4.5zM13.8 6.6l3.6 3.6" {...line} /></svg>
)

/** A speaker with sound waves: listen. */
export const SpeakerIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M3.5 9.5h3.5l5-4.5v14l-5-4.5H3.5z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
    <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.3a8 8 0 0 1 0 11.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
)

export const PlayIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
)

export const PauseIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><rect x="5.5" y="4.5" width="4.5" height="15" rx="1.2" fill="currentColor" /><rect x="14" y="4.5" width="4.5" height="15" rx="1.2" fill="currentColor" /></svg>
)

/** A bell: notifications. */
export const BellIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.8 2H4.2z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
    <path d="M9.8 20.6a2.4 2.4 0 0 0 4.4 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
)

/** Three dots: more. */
export const MoreIcon = ({ size, class: c }: P) => (
  <svg {...svg(size, c)}><circle cx="5" cy="12" r="2.2" fill="currentColor" /><circle cx="12" cy="12" r="2.2" fill="currentColor" /><circle cx="19" cy="12" r="2.2" fill="currentColor" /></svg>
)
