const SEVERITY_TAG = /\[(?:Critical|Major|Minor|Nit|Suggestion)\]/gi;

export function automatedFindingCount(text: string): number {
  if (!/automated review/i.test(text)) return 0;
  const head = text.split(/<details/i)[0];
  const inHead = head.match(SEVERITY_TAG)?.length ?? 0;
  return inHead || (text.match(SEVERITY_TAG)?.length ?? 0);
}
