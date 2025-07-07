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
} 