import type { RunOptions } from './engine/competition-runner.js';

/** The `run` command's flags that become RunOptions (commander camel-cases them). */
export interface CliRunFlags {
  logDir: string;
  claudeBin: string;
  print: boolean;
  skipSandbox?: boolean;
  commentary?: boolean;
  adversarialJudge?: boolean;
  judgePanel?: boolean;
}

/** RunOptions for `arena run`, from its parsed flags. */
export function runOptionsFromCli(opts: CliRunFlags): RunOptions {
  return {
    logDir: opts.logDir,
    claudeBin: opts.claudeBin,
    printResults: opts.print,
    skipSandbox: opts.skipSandbox ?? false,
    commentary: opts.commentary ?? false,
    adversarialJudge: opts.adversarialJudge ?? false,
    judgePanel: opts.judgePanel ?? false,
  };
}
