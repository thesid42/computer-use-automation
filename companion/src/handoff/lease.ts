export type LeaseOwner = 'automation' | 'human';

export class ControlLease {
  owner: LeaseOwner = 'automation';
  private aborted = false;

  assertAutomation(): void {
    if (this.aborted) throw new Error('lease_aborted');
    if (this.owner !== 'automation') throw new Error(`control_owned_by_${this.owner}`);
  }

  claim(actor: 'human'): void {
    if (this.aborted) throw new Error('lease_aborted');
    if (this.owner !== 'automation') throw new Error('control_already_claimed');
    this.owner = actor;
  }

  resume(actor: 'human'): void {
    if (this.aborted) throw new Error('lease_aborted');
    if (this.owner !== actor) throw new Error('human_control_required');
    this.owner = 'automation';
  }

  abort(): void {
    this.aborted = true;
    this.owner = 'human';
  }

  assertNotAborted(): void {
    if (this.aborted) throw new Error('lease_aborted');
  }
}
