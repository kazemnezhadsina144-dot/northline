import { HistoryView } from "../../components/history-view";

export default function HistoryPage() {
  return (
    <section className="page">
      <h1>History</h1>
      <p className="muted">
        This list is stored on this device only. Each status is read from Base. It is not a full account history, and clearing site data removes it.
      </p>
      <HistoryView />
    </section>
  );
}
