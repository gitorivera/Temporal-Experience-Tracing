// Arranque de la app y enrutado entre pantallas.
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { mountSetup } from './screens/setup';
import { mountTracing } from './screens/tracing';
import { mountDone } from './screens/done';

export type ScreenName = 'setup' | 'tracing' | 'done';

/** Una pantalla se monta en el contenedor y devuelve su función de limpieza. */
export type Unmount = () => void;
export type MountScreen = (root: HTMLElement, go: (to: ScreenName) => void) => Unmount;

const screens: Record<ScreenName, MountScreen> = {
  setup: mountSetup,
  tracing: mountTracing,
  done: mountDone,
};

const root = document.getElementById('app');
if (!root) throw new Error('Falta el contenedor #app');

let unmountCurrent: Unmount | null = null;

function go(to: ScreenName): void {
  unmountCurrent?.();
  root!.replaceChildren();
  unmountCurrent = screens[to](root!, go);
}

// Precachea todos los recursos para que la app funcione sin conexión.
if ('serviceWorker' in navigator) {
  registerSW({ immediate: true });
}

go('setup');
