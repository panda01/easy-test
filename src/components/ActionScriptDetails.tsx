import { type ReactElement } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import CodeBlock from "./CodeBlock";
import { type ActionScriptRecord } from "../hooks/useActionScripts";
import { formatCount } from "../utils/formatCount";

/** Props for `ActionScriptDetails`. */
export interface ActionScriptDetailsProps {
  /** The script version to show. */
  script: ActionScriptRecord;
  /** Its version number, counting the oldest as 1. */
  versionNumber: number;
}

/**
 * One saved script version in full: when and by which model it was generated
 * and for which START_URL, a warning listing any rule violations (the script
 * is still runnable - the check only warns), Claude's summary and
 * assumptions, and the code itself.
 * @param props - The script and its version number
 * @returns The rendered script
 */
export default function ActionScriptDetails(props: ActionScriptDetailsProps): ReactElement {
  const { script, versionNumber } = props;
  const scriptHasRuleViolations = script.ruleViolations.length > 0;
  const scriptHasAssumptions = script.assumptions.length > 0;

  return (
    <Box>
      <Typography variant="subtitle1" component="h3">
        Version {versionNumber}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 2 }}>
        Generated {new Date(script.createdAt).toLocaleString()} · {script.modelId} · START_URL{" "}
        {script.startUrl}
      </Typography>

      {scriptHasRuleViolations && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>
            {formatCount(script.ruleViolations.length, "rule warning", "rule warnings")}
          </AlertTitle>
          This script uses features a real user could not. It is saved and can still be run. The
          check is a plain text search, so a name in a comment can also trigger it.
          <List dense disablePadding aria-label="Rule warnings">
            {script.ruleViolations.map((ruleViolation, ruleViolationIndex) => (
              <ListItem key={`${String(ruleViolationIndex)}-${ruleViolation}`} disableGutters>
                <ListItemText primary={ruleViolation} />
              </ListItem>
            ))}
          </List>
        </Alert>
      )}

      <Typography variant="subtitle2" component="h4">
        Summary
      </Typography>
      <Typography sx={{ mb: 2 }}>{script.summary}</Typography>

      <Typography variant="subtitle2" component="h4">
        Assumptions
      </Typography>
      {scriptHasAssumptions ? (
        <List dense disablePadding aria-label="Assumptions" sx={{ mb: 2 }}>
          {script.assumptions.map((assumption, assumptionIndex) => (
            <ListItem key={`${String(assumptionIndex)}-${assumption}`} disableGutters>
              <ListItemText primary={assumption} />
            </ListItem>
          ))}
        </List>
      ) : (
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          No assumptions recorded.
        </Typography>
      )}

      <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>
        Code
      </Typography>
      <CodeBlock code={script.code} label="Script code" />
    </Box>
  );
}
