export interface Token { text: string; line: number; column: number; }
export interface Span { start: number; end: number; }
export type LanguageConfig = { civet: boolean; civetParseOptions?: Record<string, any> };

export class SourceInspector {
    private readonly lines: string[];
    private readonly tokensByLine: Map<number, Token[]>;
    private readonly commentSpans: Map<number, Span[]>;
    private readonly stringSpans: Map<number, Span[]>;
    private readonly lineStarts: number[];

    constructor(sourceCode: string, config: LanguageConfig) {
        this.lines = sourceCode.split('\n');
        this.tokensByLine = new Map();
        this.commentSpans = new Map();
        this.stringSpans = new Map();

        this.lineStarts = [0];
        for (let i = 0; i < this.lines.length - 1; i++) {
            this.lineStarts.push(this.lineStarts[i] + this.lines[i].length + 1);
        }
        this._parse(sourceCode, config);
    }

    private _parse(source: string, config: LanguageConfig): void {
        const tokenRegex = /[\p{L}_$][\p{L}\p{N}_$]*|\d+/gu;
        const commentChars = config.civet ? ['#', '//'] : ['//'];
        const multiLineCommentStart = '/*';
        const multiLineCommentEnd = '*/';

        enum State { Default, InString, InComment }
        let state = State.Default;
        let quoteChar: '"' | "'" | '`' | null = null;
        let commentType: 'single' | 'multi' | null = null;
        let spanStart = -1;

        for (let i = 0; i < source.length; i++) {
            const char = source[i];

            if (state === State.Default) {
                // Check for string start
                if (char === "'" || char === '"' || char === '`') {
                    state = State.InString;
                    quoteChar = char;
                    spanStart = i;
                    continue;
                }
                // Check for comment start
                if (commentChars.some(c => source.startsWith(c, i))) {
                    state = State.InComment;
                    commentType = 'single';
                    spanStart = i;
                    continue;
                }
                if (source.startsWith(multiLineCommentStart, i)) {
                    state = State.InComment;
                    commentType = 'multi';
                    spanStart = i;
                    i += 1; // Skip the '*'
                    continue;
                }
            }

            if (state === State.InString) {
                if (char === '\\') { // Skip escaped character
                    i++;
                } else if (char === quoteChar) {
                    this._recordSpan(this.stringSpans, spanStart, i + 1);
                    state = State.Default;
                    quoteChar = null;
                }
            } else if (state === State.InComment) {
                if (commentType === 'single' && char === '\n') {
                    this._recordSpan(this.commentSpans, spanStart, i);
                    state = State.Default;
                    commentType = null;
                } else if (commentType === 'multi' && source.startsWith(multiLineCommentEnd, i)) {
                    this._recordSpan(this.commentSpans, spanStart, i + 2);
                    state = State.Default;
                    commentType = null;
                    i += 1; // Skip the '/'
                }
            }
        }
        // Handle unclosed spans at EOF
        if (state !== State.Default && spanStart !== -1) {
            const map = state === State.InString ? this.stringSpans : this.commentSpans;
            this._recordSpan(map, spanStart, source.length);
        }
        
        // Now, perform a separate pass for tokenization on unmasked source
        this.lines.forEach((line, lineNum) => {
            let match;
            while ((match = tokenRegex.exec(line)) !== null) {
                const tokenText = match[0];
                const col = match.index;
                if (!this.isPositionMasked(lineNum, col)) {
                    if (!this.tokensByLine.has(lineNum)) {
                        this.tokensByLine.set(lineNum, []);
                    }
                    this.tokensByLine.get(lineNum)!.push({
                        text: tokenText,
                        line: lineNum,
                        column: col
                    });
                }
            }
        });
    }

    private _getLineNumber(charIndex: number): number {
        const lineIdx = this.lineStarts.findIndex((startPos, i) => charIndex >= startPos && charIndex < (this.lineStarts[i + 1] || Infinity));
        return lineIdx === -1 ? this.lines.length - 1 : lineIdx;
    }

    private _recordSpan(map: Map<number, Span[]>, start: number, end: number): void {
        const startLine = this._getLineNumber(start);
        const endLine = this._getLineNumber(end > 0 ? end - 1 : 0);

        for (let line = startLine; line <= endLine; line++) {
            if (!map.has(line)) map.set(line, []);
            const lineStartPos = this.lineStarts[line];
            const spanStartCol = (line === startLine) ? start - lineStartPos : 0;
            const spanEndCol = (line === endLine) ? end - lineStartPos : this.lines[line].length;
            map.get(line)!.push({ start: spanStartCol, end: spanEndCol });
        }
    }

    public isPositionMasked(line: number, col: number): boolean {
        return this.commentSpans.get(line)?.some(s => col >= s.start && col < s.end) ||
               this.stringSpans.get(line)?.some(s => col >= s.start && col < s.end) || false;
    }

    public getTokenAt(line: number, col: number): Token | null {
        return this.tokensByLine.get(line)?.find(token => col >= token.column && col < token.column + token.text.length) || null;
    }

    public findToken(tokenText: string, searchLine: number, searchRadius: number): Token | null {
        for (let i = 0; i <= searchRadius; i++) {
            for (const lineOffset of (i === 0 ? [0] : [-i, i])) {
                const currentLine = searchLine + lineOffset;
                if (this.tokensByLine.has(currentLine)) {
                    const found = this.tokensByLine.get(currentLine)!.find(token => token.text === tokenText && !this.isPositionMasked(currentLine, token.column));
                    if (found) return found;
                }
            }
        }
        return null;
    }

    public getLineCount(): number {
        return this.lines.length;
    }
}