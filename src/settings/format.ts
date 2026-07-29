/** Format a count for UI copy without putting raw numbers in template literals. */
export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
	return `${String(count)} ${count === 1 ? singular : plural}`;
}
