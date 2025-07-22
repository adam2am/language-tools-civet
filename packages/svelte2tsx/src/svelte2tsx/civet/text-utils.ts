import type { CivetBlock } from './types';

/**
 * Creates a utility to convert 1-based line/column pairs to 0-based character offsets.
 * @param text The text to index.
 */
export function createPositionConverter(text: string) {
    const lineOffsets: number[] = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') {
            lineOffsets.push(i + 1);
        }
    }

    return {
        toOffset(line: number, column: number): number {
            if (line < 1 || line > lineOffsets.length) {
                return -1;
            }
            const off = lineOffsets[line - 1] + column;
            return off;
        },
        toLineCol(offset: number): { line: number, column: number } {
            let line = 1;
            for (let i = 1; i < lineOffsets.length; i++) {
                if (offset < lineOffsets[i]) {
                    break;
                }
                line = i + 1;
            }
            const column = offset - lineOffsets[line - 1];
            return { line, column };
        }
    };
}

/**
 * Finds which block, if any, a character offset belongs to.
 * Assumes blocks are sorted by startOffset.
 * @returns The index of the containing block, or -1 if none.
 */
export function findContainingBlock(blocks: CivetBlock[], offset: number): number {
    let low = 0;
    let high = blocks.length - 1;
    let result = -1;
    

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const block = blocks[mid];

        if (offset >= block.startOffset && offset <= block.endOffset) {  // Changed < to <=
            return mid; 
        } else if (offset < block.startOffset) {
            high = mid - 1;
        } else {
            low = mid + 1;
        }
    }

    return result;
} 