export default function Toast({ mensaje, tipo = "ok" }) {
  if (!mensaje) return null;
  return (
    <div className={`toast ${tipo === "error" ? "toast--error" : ""}`} role="status">
      {mensaje}
    </div>
  );
}
