export function MockNotice({ isMock }: { isMock: boolean }) {
  return isMock ? (
    <p className="mock">Showing mock data (gateway unavailable or stubbed).</p>
  ) : null;
}
