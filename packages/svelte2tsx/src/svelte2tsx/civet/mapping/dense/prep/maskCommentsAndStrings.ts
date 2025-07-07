/**
 * @file maskCommentsAndStrings: 
 *    Builds column-based masks to identify comment and string regions.
 * - `commentMasks`: Marks columns that are part of a line (`//`) or block (`/*`) comment.
 * - `stringMasks`: Marks columns inside string or template literals.
 */
import { FastBitSet } from '../bitset';

export interface CommentStringMasks {
  commentMasks: FastBitSet<number>[];
  stringMasks: FastBitSet<number>[];
}

/**
 * Scan Civet source lines once and return two FastBitSet masks per line:
 *  • commentMask – columns which sit inside line-/block-comments (// or / * * /)
 *  • stringMask  – columns inside string or template literals (' " `)
 *
 * Both masks are conservative – we err on the side of marking a column as
 * inside if unsure. This prevents accidental anchor matches inside comments
 * at the cost of slightly shrinking the usable column space.
 */
export function buildCommentStringMasks(
  lines: string[],
): CommentStringMasks {
  const commentMasks: FastBitSet<number>[] = lines.map(() => new FastBitSet());
  const stringMasks: FastBitSet<number>[] = lines.map(() => new FastBitSet());

  let inBlockComment = false;
  let inString: string | null = null;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const cMask = commentMasks[lineIdx];
    const sMask = stringMasks[lineIdx];

    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      const next = col + 1 < line.length ? line[col + 1] : '';

      // -------------------------------------------------------------------
      // 1. Currently inside a multi-line /* … */ comment
      // -------------------------------------------------------------------
      if (inBlockComment) {
        cMask.add(col);
        if (ch === '*' && next === '/') {
          cMask.add(col + 1);
          inBlockComment = false;
          col++; // skip '/'
        }
        continue;
      }

      // -------------------------------------------------------------------
      // 2. Currently inside a string or template literal
      // -------------------------------------------------------------------
      if (inString) {
        sMask.add(col);
        if (ch === '\\') {
          // Skip escaped char – mark it, too.
          if (col + 1 < line.length) {
            sMask.add(col + 1);
            col++;
          }
          continue;
        }
        if (ch === inString) {
          // Closing quote/backtick
          inString = null;
        }
        continue;
      }

      // -------------------------------------------------------------------
      // 3. We are in regular code – look for comment or string openers
      // -------------------------------------------------------------------
      if (ch === '/' && next === '/') {
        // Line comment – mark rest of line and break
        for (let j = col; j < line.length; j++) cMask.add(j);
        break;
      }
      if (ch === '/' && next === '*') {
        // Multi-line comment – mark opener and enter state
        cMask.add(col);
        cMask.add(col + 1);
        inBlockComment = true;
        col++; // skip '*'
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
        sMask.add(col);
        continue;
      }
    }
  }

  return { commentMasks, stringMasks };
} 