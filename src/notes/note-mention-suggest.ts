import {
    AbstractInputSuggest,
    type App,
    prepareFuzzySearch,
    type TFile,
} from 'obsidian';
import type { NoteMention } from './parse-mentions';

const MAX_SUGGESTIONS = 20;

/**
 * Type-ahead suggest for `@path/to/note.md` mentions in the chat textarea.
 */
export class NoteMentionSuggest extends AbstractInputSuggest<TFile> {
    private readonly textarea: HTMLTextAreaElement;
    private readonly onSelectMention?: (mention: NoteMention) => void;

    constructor(
        app: App,
        textarea: HTMLTextAreaElement,
        onSelectMention?: (mention: NoteMention) => void,
    ) {
        super(app, textarea as unknown as HTMLInputElement);
        this.textarea = textarea;
        this.onSelectMention = onSelectMention;
    }

    protected getSuggestions(_inputStr: string): TFile[] {
        const query = this.getMentionQuery();
        if (query === null) {
            return [];
        }

        const files = this.app.vault.getMarkdownFiles();

        if (query === '') {
            return files
                .sort((a, b) => a.path.localeCompare(b.path))
                .slice(0, MAX_SUGGESTIONS);
        }

        const fuzzy = prepareFuzzySearch(query);
        return files
            .map((file) => {
                const pathMatch = fuzzy(file.path);
                const baseMatch = fuzzy(file.basename);
                const matches = [pathMatch, baseMatch].filter(
                    (match): match is NonNullable<typeof pathMatch> => match !== null,
                );
                const best =
                    matches.length > 0
                        ? matches.reduce((a, b) => (a.score >= b.score ? a : b))
                        : null;
                return best ? { file, score: best.score } : null;
            })
            .filter((item): item is { file: TFile; score: number } => item !== null)
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_SUGGESTIONS)
            .map((item) => item.file);
    }

    renderSuggestion(file: TFile, el: HTMLElement): void {
        el.empty();
        el.createDiv({ cls: 'lava-mention-suggest__name', text: file.basename });
        el.createDiv({ cls: 'lava-mention-suggest__path', text: file.path });
    }

    selectSuggestion(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
        const cursor = this.textarea.selectionStart;
        const value = this.textarea.value;
        const before = value.slice(0, cursor);
        const after = value.slice(cursor);
        const mention = `@${file.path}`;
        const newBefore = before.replace(/@([^\s@]*)$/, mention);
        const newValue = newBefore + after;
        const newCursor = newBefore.length;

        this.onSelectMention?.({
            path: file.path,
            start: newCursor - mention.length,
            end: newCursor,
        });
        this.textarea.value = newValue;
        this.textarea.selectionStart = newCursor;
        this.textarea.selectionEnd = newCursor;
        this.textarea.dispatchEvent(new Event('input', { bubbles: true }));
        this.close();
    }

    private getMentionQuery(): string | null {
        const cursor = this.textarea.selectionStart;
        const before = this.textarea.value.slice(0, cursor);
        const match = before.match(/@([^\s@]*)$/);
        if (!match) {
            return null;
        }
        return match[1] ?? '';
    }
}
