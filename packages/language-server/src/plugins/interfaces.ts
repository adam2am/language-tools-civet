import {
    CancellationToken,
    CompletionContext,
    FileChangeType,
    LinkedEditingRanges,
    SemanticTokens,
    SignatureHelpContext,
    TextDocumentContentChangeEvent
} from 'vscode-languageserver';
import {
    CallHierarchyIncomingCall,
    CallHierarchyItem,
    CallHierarchyOutgoingCall,
    CodeAction,
    CodeActionContext,
    CodeLens,
    Color,
    ColorInformation,
    ColorPresentation,
    CompletionItem,
    CompletionList,
    DefinitionLink,
    Diagnostic,
    DocumentHighlight,
    FoldingRange,
    FormattingOptions,
    Hover,
    InlayHint,
    Location,
    Position,
    Range,
    ReferenceContext,
    SelectionRange,
    SignatureHelp,
    SymbolInformation,
    TextDocumentIdentifier,
    TextEdit,
    WorkspaceEdit,
    WorkspaceSymbol
} from 'vscode-languageserver-types';
import { Document } from '../lib/documents';

export type Resolvable<T> = T | Promise<T>;

export interface AppCompletionItem<T extends TextDocumentIdentifier = any> extends CompletionItem {
    data?: T;
}

export interface AppCompletionList<T extends TextDocumentIdentifier = any> extends CompletionList {
    items: Array<AppCompletionItem<T>>;
}

export interface DiagnosticsProvider {
    getDiagnostics(document: Document): Resolvable<Diagnostic[]>;
}

export interface HoverProvider {
    doHover(document: Document, position: Position): Resolvable<Hover | null>;
}

export interface CompletionsProvider<T extends TextDocumentIdentifier = any> {
    getCompletions(
        document: Document,
        position: Position,
        completionContext?: CompletionContext,
        cancellationToken?: CancellationToken
    ): Resolvable<AppCompletionList<T> | null>;

    resolveCompletion?(
        document: Document,
        completionItem: AppCompletionItem<T>,
        cancellationToken?: CancellationToken
    ): Resolvable<AppCompletionItem<T>>;
}

export interface FormattingProvider {
    formatDocument(document: Document, options: FormattingOptions): Resolvable<TextEdit[]>;
}

export interface TagCompleteProvider {
    doTagComplete(document: Document, position: Position): Resolvable<string | null>;
}

export interface DocumentColorsProvider {
    getDocumentColors(document: Document): Resolvable<ColorInformation[]>;
}

export interface ColorPresentationsProvider {
    getColorPresentations(
        document: Document,
        range: Range,
        color: Color
    ): Resolvable<ColorPresentation[]>;
}

export interface DocumentSymbolsProvider {
    getDocumentSymbols(
        document: Document,
        cancellationToken?: CancellationToken
    ): Resolvable<SymbolInformation[]>;
}

export interface DefinitionsProvider {
    getDefinitions(document: Document, position: Position): Resolvable<DefinitionLink[]>;
}

export interface BackwardsCompatibleDefinitionsProvider {
    getDefinitions(
        document: Document,
        position: Position
    ): Resolvable<DefinitionLink[] | Location[]>;
}

export interface CodeActionsProvider {
    getCodeActions(
        document: Document,
        range: Range,
        context: CodeActionContext,
        cancellationToken?: CancellationToken
    ): Resolvable<CodeAction[]>;
    executeCommand?(
        document: Document,
        command: string,
        args?: any[]
    ): Resolvable<WorkspaceEdit | string | null>;

    resolveCodeAction?(
        document: Document,
        codeAction: CodeAction,
        cancellationToken?: CancellationToken
    ): Resolvable<CodeAction>;
}

export interface FileRename {
    oldUri: string;
    newUri: string;
}

export interface UpdateImportsProvider {
    updateImports(fileRename: FileRename): Resolvable<WorkspaceEdit | null>;
}

export interface RenameProvider {
    rename(
        document: Document,
        position: Position,
        newName: string
    ): Resolvable<WorkspaceEdit | null>;
    prepareRename(document: Document, position: Position): Resolvable<Range | null>;
}

export interface FindReferencesProvider {
    findReferences(
        document: Document,
        position: Position,
        context: ReferenceContext,
        cancellationToken?: CancellationToken
    ): Promise<Location[] | null>;
}

export interface FileReferencesProvider {
    fileReferences(uri: string): Promise<Location[] | null>;
}

export interface FindComponentReferencesProvider {
    findComponentReferences(uri: string): Promise<Location[] | null>;
}

export interface SignatureHelpProvider {
    getSignatureHelp(
        document: Document,
        position: Position,
        context: SignatureHelpContext | undefined,
        cancellationToken?: CancellationToken
    ): Resolvable<SignatureHelp | null>;
}

export interface SelectionRangeProvider {
    getSelectionRange(document: Document, position: Position): Resolvable<SelectionRange | null>;
}

export interface SemanticTokensProvider {
    getSemanticTokens(textDocument: Document, range?: Range): Resolvable<SemanticTokens | null>;
}

export interface LinkedEditingRangesProvider {
    getLinkedEditingRanges(
        document: Document,
        position: Position
    ): Resolvable<LinkedEditingRanges | null>;
}

export interface ImplementationProvider {
    getImplementation(
        document: Document,
        position: Position,
        cancellationToken?: CancellationToken
    ): Resolvable<Location[] | null>;
}

export interface TypeDefinitionProvider {
    getTypeDefinition(document: Document, position: Position): Resolvable<Location[] | null>;
}

export interface CallHierarchyProvider {
    prepareCallHierarchy(
        document: Document,
        position: Position
    ): Resolvable<CallHierarchyItem[] | null>;

    getIncomingCalls(
        item: CallHierarchyItem,
        cancellationToken?: CancellationToken
    ): Resolvable<CallHierarchyIncomingCall[] | null>;

    getOutgoingCalls(
        item: CallHierarchyItem,
        cancellationToken?: CancellationToken
    ): Resolvable<CallHierarchyOutgoingCall[] | null>;
}

export interface CodeLensProvider {
    getCodeLens(document: Document): Resolvable<CodeLens[] | null>;
    resolveCodeLens(
        document: Document,
        codeLensToResolve: CodeLens,
        cancellationToken?: CancellationToken
    ): Resolvable<CodeLens>;
}

export interface OnWatchFileChangesPara {
    fileName: string;
    changeType: FileChangeType;
}

export interface InlayHintProvider {
    getInlayHints(
        document: Document,
        range: Range,
        cancellationToken?: CancellationToken
    ): Resolvable<InlayHint[] | null>;
}

export interface FoldingRangeProvider {
    getFoldingRanges(document: Document): Resolvable<FoldingRange[]>;
}

export interface DocumentHighlightProvider {
    findDocumentHighlight(
        document: Document,
        position: Position
    ): Resolvable<DocumentHighlight[] | null>;
}

export interface WorkspaceSymbolsProvider {
    getWorkspaceSymbols(
        query: string,
        cancellationToken?: CancellationToken
    ): Resolvable<WorkspaceSymbol[] | null>;
}

export interface OnWatchFileChanges {
    onWatchFileChanges(onWatchFileChangesParas: OnWatchFileChangesPara[]): void;
}

export interface UpdateTsOrJsFile {
    updateTsOrJsFile(fileName: string, changes: TextDocumentContentChangeEvent[]): void;
}

type ProviderBase = DiagnosticsProvider &
    HoverProvider &
    CompletionsProvider &
    FormattingProvider &
    TagCompleteProvider &
    DocumentColorsProvider &
    ColorPresentationsProvider &
    DocumentSymbolsProvider &
    UpdateImportsProvider &
    CodeActionsProvider &
    FindReferencesProvider &
    FileReferencesProvider &
    FindComponentReferencesProvider &
    RenameProvider &
    SignatureHelpProvider &
    SemanticTokensProvider &
    LinkedEditingRangesProvider &
    ImplementationProvider &
    TypeDefinitionProvider &
    InlayHintProvider &
    CallHierarchyProvider &
    FoldingRangeProvider &
    CodeLensProvider &
    DocumentHighlightProvider &
    WorkspaceSymbolsProvider;

export type LSProvider = ProviderBase & BackwardsCompatibleDefinitionsProvider;

export interface LSPProviderConfig {
    /**
     * Whether or not completion lists that are marked as imcomplete
     * should be filtered server side.
     */
    filterIncompleteCompletions: boolean;
    /**
     * Whether or not getDefinitions supports the LocationLink interface.
     */
    definitionLinkSupport: boolean;
}

export type Plugin = Partial<
    ProviderBase &
        DefinitionsProvider &
        OnWatchFileChanges &
        SelectionRangeProvider &
        UpdateTsOrJsFile
> & { __name: string };
