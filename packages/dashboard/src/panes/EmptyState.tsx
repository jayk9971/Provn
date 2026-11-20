/** Placeholder shown when a pane has nothing to show yet. */
export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <p className="empty">
      <strong>{title}</strong>
      <span>{detail}</span>
    </p>
  );
}
