/**
 * @file Merge `names` from multiple sourcemaps, calculating offsets
 */

export interface NameMappable {
    names?: string[];
}

export function mergeNames(base: NameMappable, blocks: NameMappable[]): { finalNames: string[]; nameOffsets: number[] } {
    const finalNames = [...(base.names || [])];
    const nameOffsets: number[] = [];

    for (const block of blocks) {
        nameOffsets.push(finalNames.length);
        if (block.names) {
            finalNames.push(...block.names);
        }
    }

    return { finalNames, nameOffsets };
} 