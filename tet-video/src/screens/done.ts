// Pantalla final y descargas (SPEC §11). Se construye en la fase 6.
import type { MountScreen } from '../main';

export const mountDone: MountScreen = (root, go) => {
  const el = document.createElement('section');
  el.className = 'researcher';
  el.innerHTML = `
    <p class="big" style="font-size:3rem;text-align:center;padding:40px 0">¡Terminaste! Gracias por jugar.</p>
    <div class="row" style="justify-content:center">
      <button class="btn sea" id="back">Nueva sesión</button>
    </div>
  `;
  root.append(el);
  el.querySelector('#back')!.addEventListener('click', () => go('setup'));
  return () => {};
};
