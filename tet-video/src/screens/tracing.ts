// Pantalla del niño (SPEC §7). Se construye en la fase 5.
import type { MountScreen } from '../main';

export const mountTracing: MountScreen = (root, go) => {
  const el = document.createElement('section');
  el.className = 'kid-screen';
  el.innerHTML = `
    <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:20px">
      <p class="big" style="font-size:2.4rem">Pantalla de trazado (fase 5)</p>
      <button class="btn primary kid" id="back">Volver</button>
    </div>
  `;
  root.append(el);
  el.querySelector('#back')!.addEventListener('click', () => go('setup'));
  return () => {};
};
