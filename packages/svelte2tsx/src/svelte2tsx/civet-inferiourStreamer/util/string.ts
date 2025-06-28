// Helper to normalize path separators to forward slashes for comparison
export function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, '/');
}

/**
 * Strip the common leading whitespace from all non-empty lines of the snippet.
 * Returns the dedented string and the indent that was removed.
 */
export function stripCommonIndent(snippet: string): { dedented: string; indent: string } {
  const lines = snippet.split('\n');

  // Find the minimum indentation of non-empty lines
  let minIndent: number | null = null;
  for (const line of lines) {
    if (line.trim() === '') continue; // skip empty lines

    const match = line.match(/^\s*/);
    const indentLength = match ? match[0].length : 0;

    if (minIndent === null || indentLength < minIndent) {
      minIndent = indentLength;
    }
  }

  if (minIndent === null || minIndent === 0) {
    // No common indent, or snippet is empty/has no indented lines
    return { dedented: snippet, indent: '' };
  }

  const indentToRemove = lines.find(line => line.trim() !== '')?.substring(0, minIndent) || '';
  
  const dedentedLines = lines.map(line => {
    // only strip from non-empty lines that have the common indent
    if (line.trim() !== '' && line.startsWith(indentToRemove)) {
      return line.substring(minIndent);
    }
    return line;
  });

  return { dedented: dedentedLines.join('\n'), indent: indentToRemove };
} 