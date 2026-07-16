import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function renderAssistantMarkdown(source: string): string {
    if (!source) return '';
    const html = marked.parse(source, { async: false });
    return DOMPurify.sanitize(html);
}
