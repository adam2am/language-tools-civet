export class lineOffsetIndex {
    private lineOffsets: number[];
    constructor(content: string) {
        this.lineOffsets = [0]; // First line starts at offset 0
        for (let i = 0; i < content.length; i++) {
            if (content[i] === '\n') {
                this.lineOffsets.push(i + 1);
            }
        }
        // Ensure sentinel offset for EOF so that requesting offsetOf(lastLine+1,0)
        // is always valid (when file ends with a trailing newline).
        if (this.lineOffsets[this.lineOffsets.length - 1] !== content.length) {
            this.lineOffsets.push(content.length);
        }
    }
  
    offsetOf(line1Based: number, col0Based: number): number {
        if (line1Based < 1 || line1Based > this.lineOffsets.length) {
            console.warn(`[LineOffsetCalculator] Line ${line1Based} out of bounds (1-${this.lineOffsets.length}). Clamping.`);
            line1Based = Math.max(1, Math.min(line1Based, this.lineOffsets.length));
        }
        const lineStartOffset = this.lineOffsets[line1Based - 1];
        return lineStartOffset + col0Based;
    }

    positionFor(offset: number): { line: number, column: number } {
        let line = 1;
        while (line < this.lineOffsets.length && this.lineOffsets[line] <= offset) {
            line++;
        }
        const lineStartOffset = this.lineOffsets[line - 1];
        const column = offset - lineStartOffset;
        return { line, column };
    }
}

/**
 * Standard binary search on a sorted array of sourcemap segments.
 * Finds the index of the segment whose `generatedColumn` is less than or
 * equal to the target column.
 */
export function binarySearch(
  segments: readonly (readonly number[])[],
  targetCol: number
): number {
  let lo = 0;
  let hi = segments.length - 1;
  let bestIndex = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (segments[mid][0] <= targetCol) {
      bestIndex = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return bestIndex;
}

/**
 * Performs a binary search on a sorted array of blocks to find the index
 * of the first block whose `tsSnippet.startOffset` is greater than the
 * target `charOffset`.
 *
 * This is used to efficiently locate which Civet block a particular character
 * in the template corresponds to.
 *
 * @param blocks A sorted array of block objects.
 * @param charOffset The character offset to search for.
 * @returns The index of the found block, or `blocks.length` if not found.
 */
export function findBlockForOffset(blocks: { tsSnippet: { startOffset: number } }[], charOffset: number): number {
    let low = 0;
    let high = blocks.length - 1;
    let index = blocks.length;

    while (low <= high) {
        const mid = low + Math.floor((high - low) / 2);
        if (blocks[mid].tsSnippet.startOffset > charOffset) {
            index = mid;
            high = mid - 1;
        } else {
            low = mid + 1;
        }
    }
    return index;
}

/**
 * Performs a binary search on a sorted array of blocks to find the index
 * of the block that contains the target `charOffset`.
 *
 * @param blocks A sorted array of block objects with start and end offsets.
 * @param charOffset The character offset to search for.
 * @returns The index of the found block, or -1 if not found.
 */
export function findContainingBlock(blocks: { tsSnippet: { startOffset: number, length: number } }[], charOffset: number): number {
    let low = 0;
    let high = blocks.length - 1;

    while (low <= high) {
        const mid = low + Math.floor((high - low) / 2);
        const block = blocks[mid];
        const { startOffset, length } = block.tsSnippet;
        const endOffset = startOffset + length;

        if (charOffset >= startOffset && charOffset < endOffset) {
            return mid;
        }

        if (charOffset < startOffset) {
            high = mid - 1;
        } else {
            low = mid + 1;
        }
    }

    return -1; // Not found
}
