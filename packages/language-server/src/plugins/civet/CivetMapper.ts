import {
    TraceMap,
    generatedPositionFor,
    originalPositionFor,
    LEAST_UPPER_BOUND,
    GREATEST_LOWER_BOUND,
    type SourceMapInput
} from '@jridgewell/trace-mapping';
import { DocumentMapper } from '../../lib/documents';
import type { Position } from 'vscode-languageserver-types';
import { civetLog } from './logger';

/**
 * A DocumentMapper that uses the robust `trace-mapping` library for all Civet transformations.
 * It is aware of the line-offset introduced by svelte2tsx prepending content.
 */
export class CivetMapper implements DocumentMapper {
    private traceMap: TraceMap;
    private sourceContent: string;

    constructor(
        sourceMap: { mappings: string; sources: string[]; sourcesContent?: string[] },
        private url: string,
        private nrPrependedLines = 0
    ) {
        this.traceMap = new TraceMap(sourceMap as SourceMapInput);
        // Store the original source content for more accurate character mapping
        this.sourceContent = sourceMap.sourcesContent?.[0] ?? '';
    }

    /**
     * Maps a position from the generated TSX file back to the original Civet source file.
     */
    getOriginalPosition(generatedPosition: Position): Position {
        civetLog(
            'CivetMapper.ts',
            30,
            'getOriginalPosition INPUT',
            JSON.stringify(generatedPosition)
        );

        // Adjust for prepended lines
        const adjustedPosition = {
            line: generatedPosition.line - this.nrPrependedLines,
            character: generatedPosition.character
        };

        if (adjustedPosition.line < 0) {
            return { line: 0, character: 0 };
        }

        const source = this.traceMap.sources[0];
        if (!source) {
            return adjustedPosition;
        }

        // Try exact match first
        const original = originalPositionFor(this.traceMap, {
            line: adjustedPosition.line + 1,
            column: adjustedPosition.character,
            bias: LEAST_UPPER_BOUND
        });

        if (original.line === null || original.column === null) {
            return adjustedPosition;
        }

        const result = {
            line: original.line - 1,
            character: original.column
        };

        civetLog(
            'CivetMapper.ts',
            80,
            'getOriginalPosition OUTPUT',
            JSON.stringify(result)
        );
        return result;
    }

    /**
     * Maps a position from the original Civet source file to the generated TSX file.
     */
    getGeneratedPosition(originalPosition: Position): Position {
        civetLog(
            'CivetMapper.ts',
            90,
            'getGeneratedPosition INPUT',
            JSON.stringify(originalPosition)
        );

        const source = this.traceMap.sources[0];
        if (!source) {
            return originalPosition;
        }

        // First try with GREATEST_LOWER_BOUND to get the base position
        const base = generatedPositionFor(this.traceMap, {
            source,
            line: originalPosition.line + 1,
            column: originalPosition.character,
            bias: GREATEST_LOWER_BOUND
        });

        if (base.line === null || base.column === null) {
            return originalPosition;
        }

        // Then try with LEAST_UPPER_BOUND to get the next position
        const next = generatedPositionFor(this.traceMap, {
            source,
            line: originalPosition.line + 1,
            column: originalPosition.character + 1,
            bias: LEAST_UPPER_BOUND
        });

        // If we're at the start of an identifier (base and next are different),
        // use the base position. Otherwise, use the base position's column.
        const result = {
            line: base.line - 1 + this.nrPrependedLines,
            character: base.column
        };

        civetLog(
            'CivetMapper.ts',
            118,
            'getGeneratedPosition OUTPUT',
            JSON.stringify(result)
        );
        return result;
    }

    /**
     * Checks if a position in the original document is part of the generated code.
     */
    isInGenerated(): boolean {
        return true;
    }

    /**
     * Returns the URL of the original Svelte document.
     */
    getURL(): string {
        return this.url;
    }
} 