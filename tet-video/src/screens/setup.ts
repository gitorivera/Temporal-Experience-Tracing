// Pantalla del investigador. Fase 1: marcador con muestra de tokens y fuentes.
// El formulario completo (SPEC §6) se construye en la fase 4.
import type { MountScreen } from '../main';
import { APP_VERSION } from '../state';
import { mountPlayerLab } from './playerLab';

const TOKENS = ['--bg', '--panel', '--ink', '--muted', '--line', '--sun', '--sea', '--trace', '--ok', '--warn', '--danger'];

export const mountSetup: MountScreen = (root, go) => {
  const el = document.createElement('section');
  el.className = 'researcher';
  el.innerHTML = `
    <h1>Trazado de experiencia (TET)</h1>
    <p class="lead">Versión ${APP_VERSION}. Fase 3: reproductores de video y de canvas. Más abajo siguen las muestras de estilos de la fase 1.</p>

    <div class="card">
      <h2>Tipografía</h2>
      <p class="big" style="font-size:2rem">Baloo 2 — ¿Cuánto te estabas divirtiendo?</p>
      <p>Nunito 400 — Niñas y niños de 6 a 13 años trazan cómo se sentían.</p>
      <p style="font-weight:600">Nunito 600 — Configuración de la sesión</p>
      <p style="font-weight:800">Nunito 800 — ¡Vamos! ¡Terminaste!</p>
    </div>

    <div class="card">
      <h2>Colores</h2>
      <div class="swatches">
        ${TOKENS.map((t) => `<div class="swatch"><span style="background:var(${t})"></span><code>${t}</code></div>`).join('')}
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn" data-theme-set="">Tema del sistema</button>
        <button class="btn" data-theme-set="light">Claro</button>
        <button class="btn" data-theme-set="dark">Oscuro</button>
      </div>
    </div>

    <div class="card">
      <h2>Botones</h2>
      <div class="row">
        <button class="btn primary kid">▶ Empezar</button>
        <button class="btn sea kid">Listo</button>
        <button class="btn kid">↺ Repetir</button>
        <button class="btn danger">Borrar</button>
        <button class="btn" disabled>Deshabilitado</button>
      </div>
    </div>

    <div class="card">
      <h2>Estado</h2>
      <p class="status" id="offline-status">Comprobando el modo sin conexión…</p>
      <div class="row" style="margin-top:10px">
        <button class="btn ghost" id="to-tracing">Ver pantalla de trazado (vacía)</button>
        <button class="btn ghost" id="to-done">Ver pantalla final (vacía)</button>
      </div>
    </div>
  `;
  root.append(el);

  el.querySelectorAll<HTMLButtonElement>('[data-theme-set]').forEach((b) =>
    b.addEventListener('click', () => {
      const t = b.dataset.themeSet;
      if (t) document.documentElement.dataset.theme = t;
      else delete document.documentElement.dataset.theme;
    }),
  );
  el.querySelector('#to-tracing')!.addEventListener('click', () => go('tracing'));
  el.querySelector('#to-done')!.addEventListener('click', () => go('done'));

  const status = el.querySelector<HTMLElement>('#offline-status')!;
  if (!('serviceWorker' in navigator)) {
    status.textContent = 'Este navegador no admite service workers: no funcionará sin conexión.';
    status.classList.add('warn');
  } else {
    navigator.serviceWorker.ready.then(() => {
      status.textContent = 'Lista para usarse sin conexión.';
      status.classList.add('ok');
    });
  }

  // Banco de pruebas de la fase 3, justo debajo del título para que se vea sin desplazarse.
  const unmountLab = mountPlayerLab(el.querySelector('.lead')!);

  return () => unmountLab();
};
