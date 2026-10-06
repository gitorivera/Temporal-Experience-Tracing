// Pantalla final y descargas (SPEC §11). Se construye en la fase 6.
// Por ahora muestra un resumen mínimo de la sesión recibida, para revisar la fase 5.
import type { MountScreen } from '../main';
import { practiceCorrelation } from '../practice';
import { takeFinished, type DimensionRecord } from '../state';
import { coverageOf } from '../trace/trace';

function line(rec: DimensionRecord, orden: number): string {
  const cob = Math.round(coverageOf(rec.valores) * 100);
  const tr = rec.tiempoRespuestaS === null ? '—' : `${Math.round(rec.tiempoRespuestaS)} s`;
  return `${orden}. ${rec.dimension.nombre}: cobertura ${cob} %, tiempo ${tr}, pasadas ${rec.pasadas}, toques ${rec.toques}, saltos ${rec.saltosVideo}, puntos crudos ${rec.trazoCrudo.length}, muestras 10 Hz ${rec.valores.length}`;
}

export const mountDone: MountScreen = (root, go) => {
  const s = takeFinished();
  const el = document.createElement('section');
  el.className = 'researcher';
  el.innerHTML = `
    <p class="big" style="font-size:3rem;text-align:center;padding:40px 0">¡Terminaste! Gracias por jugar.</p>
    <div class="card" id="resumen" hidden>
      <h2>Resumen provisional (la pantalla final completa es de la fase 6)</h2>
      <ul id="resumen-lista"></ul>
    </div>
    <div class="row" style="justify-content:center">
      <button class="btn sea" id="back">Nueva sesión</button>
    </div>
  `;
  root.append(el);

  if (s) {
    const lines: string[] = [];
    if (s.practica) {
      const r = practiceCorrelation(s.practica.valores);
      lines.push(`${line(s.practica, 0)}, correlación con la velocidad ${r === null ? '—' : r.toFixed(2).replace('.', ',')}`);
    }
    s.dimensiones.forEach((rec, i) => lines.push(line(rec, i + 1)));
    lines.push(`Grabación: ${s.grabacion ?? 'grabación de ejemplo'} · inicio ${s.inicio}`);
    const list = el.querySelector('#resumen-lista')!;
    for (const text of lines) {
      const li = document.createElement('li');
      li.textContent = text;
      list.append(li);
    }
    el.querySelector<HTMLElement>('#resumen')!.hidden = false;
  }

  el.querySelector('#back')!.addEventListener('click', () => go('setup'));
  return () => {};
};
