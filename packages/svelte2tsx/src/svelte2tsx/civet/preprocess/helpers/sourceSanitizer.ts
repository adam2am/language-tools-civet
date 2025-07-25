// source-sanitizer.ts

enum State {
    Default,
    InSingleLineComment,
    InMultiLineComment,
    InSingleQuoteString,
    InDoubleQuoteString,
    InTemplateString
}

export function sanitizeSource(source: string): string {
    let state = State.Default;
    const result: string[] = [];
    let i = 0;

    while (i < source.length) {
        const char = source[i];
        const nextChar = source[i + 1];

        switch (state) {
            case State.Default:
                if (char === '/' && nextChar === '/') {
                    result.push('/');
                    state = State.InSingleLineComment;
                } else if (char === '#' && (i === 0 || source[i-1].trim() === '')) {
                    result.push('#');
                    state = State.InSingleLineComment;
                } else if (char === '/' && nextChar === '*') {
                    result.push('/');
                    i++; // consume '*'
                    result.push('*');
                    state = State.InMultiLineComment;
                } else if (char === "'") {
                    result.push("'");
                    state = State.InSingleQuoteString;
                } else if (char === '"') {
                    result.push('"');
                    state = State.InDoubleQuoteString;
                } else if (char === '`') {
                    result.push('`');
                    state = State.InTemplateString;
                } else {
                    result.push(char);
                }
                break;

            case State.InSingleLineComment:
                if (char === '\n') {
                    result.push('\n');
                    state = State.Default;
                } else {
                    result.push(' ');
                }
                break;

            case State.InMultiLineComment:
                if (char === '*' && nextChar === '/') {
                    result.push('*');
                    i++; // consume '/'
                    result.push('/');
                    state = State.Default;
                } else if (char === '\n') {
                    result.push('\n');
                } else {
                    result.push(' ');
                }
                break;

            case State.InSingleQuoteString:
            case State.InDoubleQuoteString:
            case State.InTemplateString: // Simplified for now, doesn't handle nested ${}
                const endQuote = state === State.InSingleQuoteString ? "'" : state === State.InDoubleQuoteString ? '"' : '`';
                if (char === '\\') {
                    result.push('\\');
                    i++; // consume next char
                    result.push(source[i] || ' ');
                } else if (char === endQuote) {
                    result.push(endQuote);
                    state = State.Default;
                } else if (char === '\n') {
                    result.push('\n');
                } else {
                    result.push(' ');
                }
                break;
        }
        i++;
    }

    return result.join('');
}
