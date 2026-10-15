import { type ReactElement } from "react";
import Typography from "@mui/material/Typography";
import CodeBlock from "./CodeBlock";
import { type ActionScriptRunRecord } from "../hooks/useActionScriptRuns";

/**
 * Counts the lines of a run's step log, for the "Output log · 42 lines" row.
 * The log ends each line with a newline, so a final newline does not start
 * another line.
 * @param output - The run's step log
 * @returns How many lines it has; 0 when it is empty
 */
export function countOutputLines(output: string): number {
  const outputWithoutFinalNewline = output.endsWith("\n") ? output.slice(0, -1) : output;
  const outputIsEmpty = outputWithoutFinalNewline === "";
  return outputIsEmpty ? 0 : outputWithoutFinalNewline.split("\n").length;
}

/**
 * Words a run's log size for its disclosure row, e.g. "42 lines".
 * @param output - The run's step log
 * @returns The line count with its noun
 */
export function describeOutputLineCount(output: string): string {
  const lineCount = countOutputLines(output);
  return lineCount === 1 ? "1 line" : `${String(lineCount)} lines`;
}

/** Props for `ActionScriptRunOutput`. */
export interface ActionScriptRunOutputProps {
  /** The run whose step log to show. */
  run: Pick<ActionScriptRunRecord, "output" | "outputWasTruncated">;
}

/**
 * A run's step log, the content of its "Output log" row: the log as
 * monospace text (with a note when its start was dropped to fit the cap), or
 * a line saying the run logged nothing.
 * @param props - The run
 * @returns The rendered log
 */
export default function ActionScriptRunOutput(props: ActionScriptRunOutputProps): ReactElement {
  const { run } = props;
  const runHasOutput = run.output !== "";

  return (
    <>
      {run.outputWasTruncated && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
          The output was long, so only its end is kept.
        </Typography>
      )}
      {runHasOutput ? (
        <CodeBlock code={run.output} label="Run output" />
      ) : (
        <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>
          The run logged nothing.
        </Typography>
      )}
    </>
  );
}
