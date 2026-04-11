export type AgentState = 'IDLE' | 'PLAN' | 'ACT' | 'OBSERVE' | 'REFLECT' | 'DONE' | 'ERROR';

type StateChangeHandler = (state: AgentState, detail?: string) => void;

// Valid state transitions
const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  IDLE:    ['PLAN'],
  PLAN:    ['ACT', 'ERROR'],
  ACT:     ['OBSERVE', 'ERROR'],
  OBSERVE: ['REFLECT', 'ERROR'],
  REFLECT: ['PLAN', 'DONE', 'ACT', 'ERROR'],
  DONE:    ['IDLE'],
  ERROR:   ['IDLE'],
};

export class AgentStateMachine {
  private state: AgentState = 'IDLE';
  private handlers: StateChangeHandler[] = [];

  getState(): AgentState {
    return this.state;
  }

  isIdle(): boolean {
    return this.state === 'IDLE';
  }

  transition(next: AgentState, detail?: string): void {
    const valid = VALID_TRANSITIONS[this.state];
    if (!valid.includes(next)) {
      throw new Error(
        `Invalid state transition: ${this.state} → ${next}. ` +
          `Valid transitions: ${valid.join(', ')}`
      );
    }
    this.state = next;
    this.handlers.forEach(h => h(next, detail));
  }

  /**
   * Force reset to IDLE (for cleanup after cancellation or fatal error).
   */
  reset(): void {
    this.state = 'IDLE';
    this.handlers.forEach(h => h('IDLE', 'reset'));
  }

  onStateChange(handler: StateChangeHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler);
    };
  }
}
