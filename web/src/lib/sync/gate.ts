// File d'attente des synchronisations d'un processus : une seule est lue et traitée à la fois.
// Le site tourne dans un seul conteneur, donc un seul processus : cette file suffit à sérialiser
// les envois avant même d'emprunter une connexion à la base (le pool n'en a que cinq, partagées
// avec les pages) et à ne garder en mémoire qu'un document à la fois. Le verrou de la base
// (takeSyncLock) reste le garde-fou face aux autres écritures.

export type SyncGateOptions = {
  /** Envois en attente au-delà de celui en cours ; un de plus est refusé tout de suite. */
  maxWaiting: number;
  /** Attente maximale d'un envoi avant d'être refusé. */
  waitMs: number;
};

const DEFAULTS: SyncGateOptions = { maxWaiting: 4, waitMs: 20_000 };

export class SyncGate {
  private busy = false;
  private readonly queue: (() => void)[] = [];
  private readonly options: SyncGateOptions;

  constructor(options: Partial<SyncGateOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Envois en attente, celui en cours non compris. */
  get waiting(): number {
    return this.queue.length;
  }

  /**
   * Attend son tour. Rend la fonction qui libère la place (sans effet au second appel), ou null
   * si la file est pleine ou que l'attente a dépassé `waitMs`.
   */
  acquire(): Promise<(() => void) | null> {
    if (!this.busy) {
      this.busy = true;
      return Promise.resolve(this.releaser());
    }
    if (this.queue.length >= this.options.maxWaiting) return Promise.resolve(null);
    return new Promise((resolve) => {
      const turn = () => {
        clearTimeout(timer);
        resolve(this.releaser());
      };
      const timer = setTimeout(() => {
        const index = this.queue.indexOf(turn);
        if (index >= 0) this.queue.splice(index, 1);
        resolve(null);
      }, this.options.waitMs);
      this.queue.push(turn);
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) next();
      else this.busy = false;
    };
  }
}
