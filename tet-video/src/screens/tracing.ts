// Pantalla del niño (SPEC §7). Se construye en la fase 5.
// Por ahora muestra el plan recibido de la configuración, para revisar la fase 4.
import type { MountScreen } from '../main';
import { formatTime } from '../players/scenes';
import { takePlan } from '../state';

export const mountTracing: MountScreen = (root, go) => {
  const plan = takePlan();
  if (!plan) {
    // Se llegó sin pasar por la configuración (p. ej. al recargar).
    queueMicrotask(() => go('setup'));
    return () => {};
  }

  const { config, player, sincronizacion: sync } = plan;
  const lines = [
    `Participante: ${config.participante} · Condición: ${config.condicion}`,
    `Modo: ${config.modo} · Velocidad: ${String(config.velocidad).replace('.', ',')}× · Práctica: ${config.practica ? 'sí' : 'no'}`,
    `Grabación: ${plan.grabacion ?? 'grabación de ejemplo'} (${formatTime(player.duration)})`,
    `Destello en el video: ${sync.videoS.toFixed(2).replace('.', ',')} s · LSL: ${sync.lslS === null ? 'sin fila sync' : sync.lslS.toFixed(3).replace('.', ',') + ' s'}`,
    `Eventos dentro del video: ${plan.eventos.length}`,
    `Resolución de exportación: ${String(config.resolucionS).replace('.', ',')} s`,
    `Orden: ${plan.orden.map((d, i) => `${i + 1}. ${d.nombre}`).join(' · ')}`,
  ];

  const el = document.createElement('section');
  el.className = 'kid-screen';
  el.innerHTML = `
    <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:20px">
      <p class="big" style="font-size:2.4rem">Pantalla de trazado (fase 5)</p>
      <ul class="plan-summary"></ul>
      <button class="btn primary kid" id="back">Volver</button>
    </div>
  `;
  const list = el.querySelector('.plan-summary')!;
  for (const text of lines) {
    const li = document.createElement('li');
    li.textContent = text;
    list.append(li);
  }
  root.append(el);
  el.querySelector('#back')!.addEventListener('click', () => go('setup'));
  return () => player.destroy();
};
