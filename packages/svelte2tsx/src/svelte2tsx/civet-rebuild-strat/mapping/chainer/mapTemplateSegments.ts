export function mapTemplateSegments(
    tmplSegs: { segment: number[]; charOffset: number }[],
    blocks: any[], // Use a more specific type if available
    lineDeltas: number[]
): number[][] {
    const tmplLines: number[][] = [];
    for (const { segment, charOffset } of tmplSegs) {
        const [generatedCol, , preprocessedLine, preprocessedCol, nameIndex] = segment;
        let delta = 0;
        for (let k = 0; k < blocks.length; k++) {
            if (charOffset < blocks[k].tsSnippet.startOffset) {
                delta = lineDeltas[k];
                break;
            }
            delta = lineDeltas[k + 1];
        }
        tmplLines.push([generatedCol, 0, preprocessedLine - delta, preprocessedCol, nameIndex].filter(n => n !== undefined) as number[]);
    }
    return tmplLines;
} 