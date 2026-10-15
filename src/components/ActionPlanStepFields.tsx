import { type ChangeEvent, type ReactElement } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import {
  ArrowDownwardIcon,
  ArrowUpwardIcon,
  DeleteOutlineIcon,
  DragIndicatorIcon,
} from "./icons";
import {
  ARIA_ROLES,
  CREDENTIAL_PLACEHOLDERS,
  DIALOG_RESPONSES,
  PLAN_KEYS,
  PLAN_STEP_ACTIONS,
  PLAN_TARGET_KINDS,
  type PlanStep,
  type PlanStepAction,
  type PlanTargetKind,
  buildPlanTarget,
  changePlanStepAction,
  readPlanStepRule,
  readPlanTargetKind,
  readPlanTargetText,
} from "../utils/actionPlanSteps";

/** The "Find element by" choice for a `press` step that presses wherever the focus is. */
export const NO_TARGET_VALUE = "none";

/** Props for `ActionPlanStepFields`. */
export interface ActionPlanStepFieldsProps {
  /** The step's stable id in the editor (also its drag-and-drop id). */
  clientId: string;
  /** The step's 1-based position, for its heading and button labels. */
  stepNumber: number;
  /** The step as it is now. */
  step: PlanStep;
  /** True for the first step (it cannot move up). */
  isFirst: boolean;
  /** True for the last step (it cannot move down). */
  isLast: boolean;
  /** True while the plan is being saved; disables every field. */
  isDisabled: boolean;
  /** Called with the step after any field changes. */
  onChange: (clientId: string, step: PlanStep) => void;
  /** Called to move the step one place up (-1) or down (+1). */
  onMove: (clientId: string, offset: -1 | 1) => void;
  /** Called to remove the step. */
  onDelete: (clientId: string) => void;
}

/**
 * One step in the plan editor, as an outlined card: a drag handle (the card
 * can also be dragged with the keyboard - focus the handle, press Space,
 * use the arrow keys, press Space again), the step's number, its action, the
 * element it acts on, and its value; plus move-up, move-down, and delete
 * buttons.
 *
 * Only the fields the chosen action takes are shown: "Find element by" (and
 * a role + name, or one text field) when it acts on an element, and a value
 * field shaped by the action - a key list for "Press key", accept/dismiss
 * for "Answer next dialog", plain text otherwise. Changing the action keeps
 * whatever still fits (see `changePlanStepAction`).
 * @param props - The step, its position, and the callbacks
 * @returns The step's card
 */
export default function ActionPlanStepFields(props: ActionPlanStepFieldsProps): ReactElement {
  const { clientId, stepNumber, step, isFirst, isLast, isDisabled, onChange, onMove, onDelete } =
    props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: clientId,
    disabled: isDisabled,
  });
  const rule = readPlanStepRule(step.action);
  const stepTakesATarget = rule.target !== "none";
  const stepTakesAValue = rule.value !== "none";
  const targetKind = step.target === null ? NO_TARGET_VALUE : readPlanTargetKind(step.target);
  const targetText = step.target === null ? "" : readPlanTargetText(step.target);
  const targetRole = step.target !== null && "role" in step.target ? step.target.role : "button";

  /**
   * Changes the step's action, keeping the target and value where they fit.
   * @param event - The Action select's change event
   */
  const handleActionChange = (event: ChangeEvent<HTMLInputElement>): void => {
    // Every option's value is a step action, so the picked value is one too.
    onChange(clientId, changePlanStepAction(step, event.target.value as PlanStepAction));
  };

  /**
   * Changes how the element is found, keeping the text already typed.
   * @param event - The "Find element by" select's change event
   */
  const handleTargetKindChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const pickedKind = event.target.value;
    const stepActsWhereTheFocusIs = pickedKind === NO_TARGET_VALUE;
    const target = stepActsWhereTheFocusIs
      ? null
      : buildPlanTarget(pickedKind as PlanTargetKind, targetText, targetRole);
    onChange(clientId, { ...step, target });
  };

  /**
   * Changes a role target's role.
   * @param event - The Role select's change event
   */
  const handleRoleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange(clientId, { ...step, target: { role: event.target.value, name: targetText } });
  };

  /**
   * Changes the text the element is found by (a role target's name).
   * @param event - The text field's change event
   */
  const handleTargetTextChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const kind = targetKind === NO_TARGET_VALUE ? "role" : targetKind;
    onChange(clientId, { ...step, target: buildPlanTarget(kind, event.target.value, targetRole) });
  };

  /**
   * Changes the step's value.
   * @param event - The value field's change event
   */
  const handleValueChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange(clientId, { ...step, value: event.target.value });
  };

  /** Moves the step one place up. */
  const handleMoveUpClick = (): void => {
    onMove(clientId, -1);
  };

  /** Moves the step one place down. */
  const handleMoveDownClick = (): void => {
    onMove(clientId, 1);
  };

  /** Removes the step. */
  const handleDeleteClick = (): void => {
    onDelete(clientId);
  };

  const targetKindLabel =
    PLAN_TARGET_KINDS.find((targetKindOption) => targetKindOption.kind === targetKind)?.label ?? "";
  const targetTextLabel = targetKind === "role" ? "Name (blank for any)" : targetKindLabel;
  const valueLabel = rule.valueLabel;

  let valueField: ReactElement | null = null;
  if (rule.value === "key") {
    valueField = (
      <TextField
        select
        label={valueLabel}
        value={step.value ?? ""}
        onChange={handleValueChange}
        size="small"
        disabled={isDisabled}
        sx={{ minWidth: 160 }}
      >
        {PLAN_KEYS.map((key) => (
          <MenuItem key={key} value={key}>
            {key}
          </MenuItem>
        ))}
      </TextField>
    );
  } else if (rule.value === "dialogResponse") {
    valueField = (
      <TextField
        select
        label={valueLabel}
        value={step.value ?? ""}
        onChange={handleValueChange}
        size="small"
        disabled={isDisabled}
        sx={{ minWidth: 160 }}
      >
        {DIALOG_RESPONSES.map((response) => (
          <MenuItem key={response} value={response}>
            {response === "accept" ? "Accept (OK)" : "Dismiss (Cancel)"}
          </MenuItem>
        ))}
      </TextField>
    );
  } else if (stepTakesAValue) {
    const valueIsTypedText = rule.value === "text";
    valueField = (
      <TextField
        label={valueLabel}
        value={step.value ?? ""}
        onChange={handleValueChange}
        size="small"
        disabled={isDisabled}
        fullWidth
        helperText={
          valueIsTypedText
            ? `Or ${CREDENTIAL_PLACEHOLDERS.username} / ${CREDENTIAL_PLACEHOLDERS.password} to type the action's credential`
            : undefined
        }
      />
    );
  }

  return (
    <Paper
      component="li"
      ref={setNodeRef}
      variant="outlined"
      aria-label={`Step ${String(stepNumber)}`}
      sx={{
        p: 1.5,
        listStyle: "none",
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        position: "relative",
        zIndex: isDragging ? 1 : "auto",
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ alignItems: "center", flexWrap: "wrap", mb: 1.5 }}
      >
        <Tooltip title="Drag to reorder (or focus and use Space + arrow keys)">
          <IconButton
            size="small"
            aria-label={`Drag step ${String(stepNumber)}`}
            disabled={isDisabled}
            sx={{ cursor: "grab", touchAction: "none" }}
            {...attributes}
            {...listeners}
          >
            <DragIndicatorIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Typography variant="subtitle2" component="h4" sx={{ minWidth: 56 }}>
          Step {stepNumber}
        </Typography>
        <TextField
          select
          label="Action"
          value={step.action}
          onChange={handleActionChange}
          size="small"
          disabled={isDisabled}
          sx={{ minWidth: 200 }}
        >
          {PLAN_STEP_ACTIONS.map((action) => (
            <MenuItem key={action} value={action}>
              {readPlanStepRule(action).label}
            </MenuItem>
          ))}
        </TextField>
        <Stack direction="row" sx={{ ml: "auto" }}>
          <IconButton
            size="small"
            aria-label={`Move step ${String(stepNumber)} up`}
            onClick={handleMoveUpClick}
            disabled={isDisabled || isFirst}
          >
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            aria-label={`Move step ${String(stepNumber)} down`}
            onClick={handleMoveDownClick}
            disabled={isDisabled || isLast}
          >
            <ArrowDownwardIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            aria-label={`Delete step ${String(stepNumber)}`}
            onClick={handleDeleteClick}
            disabled={isDisabled}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>

      <Stack spacing={1.5}>
        {stepTakesATarget && (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField
              select
              label="Find element by"
              value={targetKind}
              onChange={handleTargetKindChange}
              size="small"
              disabled={isDisabled}
              sx={{ minWidth: 200 }}
            >
              {rule.target === "optional" && (
                <MenuItem value={NO_TARGET_VALUE}>No element (where the focus is)</MenuItem>
              )}
              {PLAN_TARGET_KINDS.map((targetKindOption) => (
                <MenuItem key={targetKindOption.kind} value={targetKindOption.kind}>
                  {targetKindOption.label}
                </MenuItem>
              ))}
            </TextField>
            {targetKind === "role" && (
              <TextField
                select
                label="Role"
                value={targetRole}
                onChange={handleRoleChange}
                size="small"
                disabled={isDisabled}
                sx={{ minWidth: 160 }}
              >
                {ARIA_ROLES.map((role) => (
                  <MenuItem key={role} value={role}>
                    {role}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {targetKind !== NO_TARGET_VALUE && (
              <TextField
                label={targetTextLabel}
                value={targetText}
                onChange={handleTargetTextChange}
                size="small"
                disabled={isDisabled}
                fullWidth
              />
            )}
          </Stack>
        )}
        {valueField}
      </Stack>
    </Paper>
  );
}
