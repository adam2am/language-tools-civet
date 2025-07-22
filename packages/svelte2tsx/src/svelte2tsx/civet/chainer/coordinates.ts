export type Line_0_Based = number;
export type Line_1_Based = number;

/** Converts a 1-based line number to a 0-based line number. */
export function toZeroBased(line: Line_1_Based): Line_0_Based {
    return line - 1;
}

/** Counts the number of logical lines in a block of text. */
export function countLogicalLines(text: string): number {
    // A single trailing newline is ignored, which is how most editors count lines.
    // The previous `+` was too greedy and incorrectly collapsed multiple trailing newlines.
    return text.split('\n').length;
}