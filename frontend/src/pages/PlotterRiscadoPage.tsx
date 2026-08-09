/**
 * Aba "Plotter (Molde Riscado)" — ferramenta Lek (gomo/cone/diamante) em
 * tela cheia. Sem fluxo de salvar projeto / editar arte por aqui.
 */
export function PlotterRiscadoPage() {
  return (
    <div className="plotter-riscado-shell">
      <div className="plotter-riscado-body">
        <div className="plotter-riscado-lek">
          <iframe
            className="plotter-riscado-lek-frame"
            title="Plotar Molde Riscado — Lek"
            src="/lek.html"
            allow="clipboard-write; downloads"
          />
        </div>
      </div>
    </div>
  );
}
