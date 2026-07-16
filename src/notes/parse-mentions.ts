export interface NoteMention {
    path: string;
    start: number;
    end: number;
}

export interface MentionTextSegment {
    text: string;
    mention?: NoteMention;
}

function isValidMention(text: string, mention: NoteMention, minimumStart: number): boolean {
    return (
        typeof mention.path === 'string' &&
        mention.path.length > 0 &&
        Number.isInteger(mention.start) &&
        Number.isInteger(mention.end) &&
        mention.start >= minimumStart &&
        mention.end > mention.start &&
        mention.end <= text.length &&
        text.slice(mention.start, mention.end) === `@${mention.path}`
    );
}

function validNoteMentions(text: string, mentions: NoteMention[]): NoteMention[] {
    let lastEnd = 0;
    return [...mentions]
        .sort((a, b) => a.start - b.start)
        .filter((mention) => {
            if (!isValidMention(text, mention, lastEnd)) return false;
            lastEnd = mention.end;
            return true;
        });
}

/**
 * Returns mention ranges that still refer to the same selected note after a
 * single text edit. Editing a mention itself removes its selected status.
 */
export function rebaseNoteMentions(
    previousText: string,
    nextText: string,
    mentions: NoteMention[],
): NoteMention[] {
    let changeStart = 0;
    while (
        changeStart < previousText.length &&
        changeStart < nextText.length &&
        previousText[changeStart] === nextText[changeStart]
    ) {
        changeStart++;
    }

    let previousEnd = previousText.length;
    let nextEnd = nextText.length;
    while (
        previousEnd > changeStart &&
        nextEnd > changeStart &&
        previousText[previousEnd - 1] === nextText[nextEnd - 1]
    ) {
        previousEnd--;
        nextEnd--;
    }

    const offset = nextEnd - previousEnd;
    const rebased = validNoteMentions(previousText, mentions)
        .flatMap((mention) => {
            if (mention.end <= changeStart) return [mention];
            if (mention.start >= previousEnd) {
                return [{ ...mention, start: mention.start + offset, end: mention.end + offset }];
            }
            return [];
        });

    return validNoteMentions(nextText, rebased);
}

/**
 * Splits text into plain and selected-note segments for safe Svelte rendering.
 */
export function splitNoteMentionText(
    text: string,
    mentions: NoteMention[] | undefined,
): MentionTextSegment[] {
    if (!mentions?.length) return [{ text }];

    const validMentions = validNoteMentions(text, mentions);

    if (!validMentions.length) return [{ text }];

    const segments: MentionTextSegment[] = [];
    let cursor = 0;
    for (const mention of validMentions) {
        if (cursor < mention.start) {
            segments.push({ text: text.slice(cursor, mention.start) });
        }
        segments.push({ text: text.slice(mention.start, mention.end), mention });
        cursor = mention.end;
    }
    if (cursor < text.length) {
        segments.push({ text: text.slice(cursor) });
    }

    return segments;
}
