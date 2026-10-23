// Verses for after a prayer: one of these, picked at random on the device,
// read in the Bible you use. The King James words stand in when that Bible
// isn't on the device. Loaded with the prayer screen, not at startup.
import type { PrayerVerse } from './prayerVerses'

export interface Comfort extends PrayerVerse { kjv: string }

const C = (book: string, chapter: number, verses: number[], kjv: string): Comfort => ({ book, chapter, verses, kjv })
export const COMFORT: Comfort[] = [
  C('Ps', 116, [1], 'I love the LORD, because he hath heard my voice and my supplications.'),
  C('Ps', 34, [17], 'The righteous cry, and the LORD heareth, and delivereth them out of all their troubles.'),
  C('Ps', 55, [22], 'Cast thy burden upon the LORD, and he shall sustain thee: he shall never suffer the righteous to be moved.'),
  C('Ps', 145, [18], 'The LORD is nigh unto all them that call upon him, to all that call upon him in truth.'),
  C('Ps', 66, [19], 'But verily God hath heard me; he hath attended to the voice of my prayer.'),
  C('Ps', 6, [9], 'The LORD hath heard my supplication; the LORD will receive my prayer.'),
  C('Ps', 46, [1], 'God is our refuge and strength, a very present help in trouble.'),
  C('Isa', 41, [10], 'Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee; yea, I will uphold thee with the right hand of my righteousness.'),
  C('Isa', 65, [24], 'And it shall come to pass, that before they call, I will answer; and while they are yet speaking, I will hear.'),
  C('Jer', 29, [12], 'Then shall ye call upon me, and ye shall go and pray unto me, and I will hearken unto you.'),
  C('Jer', 33, [3], 'Call unto me, and I will answer thee, and shew thee great and mighty things, which thou knowest not.'),
  C('Lam', 3, [22, 23], 'It is of the LORD’s mercies that we are not consumed, because his compassions fail not. They are new every morning: great is thy faithfulness.'),
  C('Matt', 7, [7], 'Ask, and it shall be given you; seek, and ye shall find; knock, and it shall be opened unto you.'),
  C('Matt', 11, [28], 'Come unto me, all ye that labour and are heavy laden, and I will give you rest.'),
  C('Mark', 11, [24], 'Therefore I say unto you, What things soever ye desire, when ye pray, believe that ye receive them, and ye shall have them.'),
  C('John', 14, [27], 'Peace I leave with you, my peace I give unto you: not as the world giveth, give I unto you. Let not your heart be troubled, neither let it be afraid.'),
  C('Rom', 8, [26], 'Likewise the Spirit also helpeth our infirmities: for we know not what we should pray for as we ought: but the Spirit itself maketh intercession for us with groanings which cannot be uttered.'),
  C('Phil', 4, [6, 7], 'Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God. And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus.'),
  C('Heb', 4, [16], 'Let us therefore come boldly unto the throne of grace, that we may obtain mercy, and find grace to help in time of need.'),
  C('1Pet', 5, [7], 'Casting all your care upon him; for he careth for you.'),
  C('1John', 5, [14], 'And this is the confidence that we have in him, that, if we ask any thing according to his will, he heareth us.'),
]

const LAST = 'plain-bible:comfort'
/** A verse at random, never the one shown last time. */
export function pickComfort(random = Math.random): Comfort {
  let last = -1
  try { last = Number(localStorage.getItem(LAST) ?? -1) } catch { /* private mode */ }
  const seen = last >= 0 && last < COMFORT.length
  let i = Math.floor(random() * (COMFORT.length - (seen ? 1 : 0)))
  if (seen && i >= last) i++
  try { localStorage.setItem(LAST, String(i)) } catch { /* private mode */ }
  return COMFORT[i]
}

