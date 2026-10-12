import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { store } from '../store';

/** Re-renders a Lit host whenever the store changes. */
export class StoreController implements ReactiveController {
  private readonly onChange = () => {
    this.host.requestUpdate();
    this.extra?.();
  };

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly extra?: () => void,
  ) {
    host.addController(this);
  }

  hostConnected() {
    store.addEventListener('change', this.onChange);
  }

  hostDisconnected() {
    store.removeEventListener('change', this.onChange);
  }
}
