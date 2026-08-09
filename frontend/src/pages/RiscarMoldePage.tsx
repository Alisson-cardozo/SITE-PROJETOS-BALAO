/**
 * Aba "Riscar Molde" — sobe uma imagem de referência (arte já pronta,
 * mandada pelo cliente) e ajusta a grade do cone/gomos por cima dela
 * (mover, escalar, girar) até bater com o desenho. Só referência visual,
 * não salva nem exporta nada.
 */
export function RiscarMoldePage() {
  return (
    <div className="plotter-riscado-shell">
      <div className="plotter-riscado-body">
        <div className="plotter-riscado-lek">
          <iframe
            className="plotter-riscado-lek-frame"
            title="Riscar Molde — grade sobre imagem de referência"
            src="/riscar-molde.html"
            allow="clipboard-write; downloads"
          />
        </div>
      </div>
    </div>
  );
}
