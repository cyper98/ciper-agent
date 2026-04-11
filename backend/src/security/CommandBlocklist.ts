/**
 * Blocks dangerous shell commands from being executed by the agent.
 */

const BLOCKED_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+)/i,   // rm -rf, rm --force
  /\brm\s+-r\b/i,                                       // rm -r
  /\bsudo\b/i,                                          // sudo anything
  /curl\s+.*\|\s*(ba)?sh/i,                             // curl | bash/sh
  /wget\s+.*\|\s*(ba)?sh/i,                             // wget | sh
  /\bdd\s+if=/i,                                        // dd if= (disk write)
  /:\(\)\s*\{.*\}/,                                     // fork bomb :(){:|:&};:
  /\bmkfs\b/i,                                          // mkfs (format disk)
  /\bfdisk\b/i,                                         // fdisk
  /\bshred\b/i,                                         // shred
  /\bchmod\s+777\b/,                                    // chmod 777
  /\bchown\s+-R\b/i,                                    // chown -R
  /\bpasswd\b/i,                                        // passwd
  /\bsu\s+-/i,                                          // su -
  />\s*\/dev\/(sd|hd|nvme)/i,                           // write to block devices
  /\biptables\b/i,                                      // firewall rules
  /\bsystemctl\s+(stop|disable|mask)\b/i,               // stop system services
  /\bkillall\b/i,                                       // killall
  /\bpkill\s+-9\b/i,                                   // pkill -9
  /\bnohup\b.*&\s*$/,                                   // background daemon creation
];

export class CommandBlocklist {
  /**
   * Checks if a command is blocked.
   * Throws with a descriptive error if blocked.
   */
  static check(command: string): void {
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        throw new Error(
          `Security: Command blocked — matches dangerous pattern "${pattern.source}".\n` +
            `Command: ${command}`
        );
      }
    }
  }

  /**
   * Returns true if the command is safe to run.
   */
  static isSafe(command: string): boolean {
    try {
      CommandBlocklist.check(command);
      return true;
    } catch {
      return false;
    }
  }
}
