import { type ChangeEvent, type ReactElement, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import AddIcon from "@mui/icons-material/Add";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ActionPlanStepFields from "./ActionPlanStepFields";
import {
  MAX_PLAN_STEPS,
  type ActionPlan,
  type PlanStep,
  findPlanProblems,
} from "../utils/actionPlanSteps";

/** Props for `ActionPlanEditor`. */
export interface ActionPlanEditorProps {
  /** The plan the editor starts from (the version being edited). */
  initialPlan: ActionPlan;
  /** True while the save request is in flight; disables every field. */
  isSaving: boolean;
  /** Why the last save failed (shown above the buttons), or null. */
  saveErrorMessage: string | null;
  /** Called with the edited plan when "Save as new version" is clicked. */
  onSave: (plan: ActionPlan) => void;
  /** Called when the user clicks Cancel. */
  onCancel: () => void;
}

/** One step in the editor, with the stable id that keys it and drags it. */
interface EditableStep {
  /** The step's id for this editing session; never sent to the server. */
  clientId: string;
  /** The step itself. */
  step: PlanStep;
}

/** The step a new "Add step" starts as: a click on a button the user names. */
const NEW_STEP: PlanStep = { action: "click", target: { role: "button", name: "" }, value: null };

/** Counts the steps created in this browser tab, to give each a unique id. */
let createdStepCount = 0;

/**
 * Gives a step a new id for this editing session. Ids only have to be
 * unique within the page, so a counter is enough.
 * @param step - The step
 * @returns The step with its id
 */
function toEditableStep(step: PlanStep): EditableStep {
  createdStepCount += 1;
  return { clientId: `plan-step-${String(createdStepCount)}`, step };
}

/**
 * The step editor for one plan version: the plan's name and start URL, then
 * its steps as cards that can be reordered (drag a card's handle - with the
 * mouse, or with the keyboard: focus the handle, Space, arrow keys, Space -
 * or use its up / down buttons), changed, deleted, or added to.
 *
 * Problems that would make the server refuse the plan (a click with no
 * element, a blank start URL, ...) are listed as you edit, and "Save as new
 * version" stays disabled until there are none and something has changed.
 * Saving never changes the version being edited: the page saves the plan as
 * a NEW version (`POST .../scripts/:actionScriptId/edits`).
 *
 * The editor keeps its own state, seeded from `initialPlan` once, on mount.
 * @param props - The starting plan, save state, and callbacks
 * @returns The plan editor
 */
export default function ActionPlanEditor(props: ActionPlanEditorProps): ReactElement {
  const { initialPlan, isSaving, saveErrorMessage, onSave, onCancel } = props;
  const [name, setName] = useState(initialPlan.name);
  const [startUrl, setStartUrl] = useState(initialPlan.startUrl);
  const [editableSteps, setEditableSteps] = useState<EditableStep[]>(() =>
    initialPlan.steps.map(toEditableStep),
  );
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const editedPlan: ActionPlan = {
    name,
    startUrl,
    steps: editableSteps.map((editableStep) => editableStep.step),
  };
  const planProblems = findPlanProblems(editedPlan);
  const planHasProblems = planProblems.length > 0;
  const planIsUnchanged = JSON.stringify(editedPlan) === JSON.stringify(initialPlan);
  const saveIsBlocked = planHasProblems || planIsUnchanged || isSaving;
  const planIsFull = editableSteps.length >= MAX_PLAN_STEPS;
  const saveFailed = saveErrorMessage !== null;

  /**
   * Keeps the plan name in sync with what the user types.
   * @param event - The input's change event
   */
  const handleNameChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setName(event.target.value);
  };

  /**
   * Keeps the start URL in sync with what the user types.
   * @param event - The input's change event
   */
  const handleStartUrlChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setStartUrl(event.target.value);
  };

  /**
   * Replaces one step after any of its fields changed.
   * @param clientId - The step's id
   * @param step - The changed step
   */
  const handleStepChange = (clientId: string, step: PlanStep): void => {
    setEditableSteps((currentSteps) =>
      currentSteps.map((editableStep) =>
        editableStep.clientId === clientId ? { clientId, step } : editableStep,
      ),
    );
  };

  /**
   * Moves one step a place up or down (the up / down buttons).
   * @param clientId - The step's id
   * @param offset - -1 for up, 1 for down
   */
  const handleStepMove = (clientId: string, offset: -1 | 1): void => {
    setEditableSteps((currentSteps) => {
      const fromIndex = currentSteps.findIndex((editableStep) => editableStep.clientId === clientId);
      const toIndex = fromIndex + offset;
      const moveStaysInTheList = fromIndex !== -1 && toIndex >= 0 && toIndex < currentSteps.length;
      return moveStaysInTheList ? arrayMove(currentSteps, fromIndex, toIndex) : currentSteps;
    });
  };

  /**
   * Removes one step.
   * @param clientId - The step's id
   */
  const handleStepDelete = (clientId: string): void => {
    setEditableSteps((currentSteps) =>
      currentSteps.filter((editableStep) => editableStep.clientId !== clientId),
    );
  };

  /**
   * Moves the dragged step to where it was dropped.
   * @param event - dnd-kit's drag end event: the dragged step and the step it was dropped on
   */
  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    const stepWasDroppedOnAnotherStep = over !== null && active.id !== over.id;
    if (!stepWasDroppedOnAnotherStep) return;
    setEditableSteps((currentSteps) => {
      const fromIndex = currentSteps.findIndex((editableStep) => editableStep.clientId === active.id);
      const toIndex = currentSteps.findIndex((editableStep) => editableStep.clientId === over.id);
      const bothStepsAreListed = fromIndex !== -1 && toIndex !== -1;
      return bothStepsAreListed ? arrayMove(currentSteps, fromIndex, toIndex) : currentSteps;
    });
  };

  /** Adds a new click step at the end. */
  const handleAddStepClick = (): void => {
    setEditableSteps((currentSteps) => [...currentSteps, toEditableStep(NEW_STEP)]);
  };

  /** Hands the edited plan to the page, unless saving is blocked. */
  const handleSaveClick = (): void => {
    if (saveIsBlocked) return;
    onSave(editedPlan);
  };

  return (
    <Box>
      <Stack spacing={2} sx={{ mb: 2 }}>
        <TextField
          label="Plan name"
          value={name}
          onChange={handleNameChange}
          size="small"
          disabled={isSaving}
          fullWidth
        />
        <TextField
          label="Start URL"
          value={startUrl}
          onChange={handleStartUrlChange}
          size="small"
          disabled={isSaving}
          fullWidth
          helperText="The page the browser opens (after logging in) before the first step"
        />
      </Stack>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={editableSteps.map((editableStep) => editableStep.clientId)}
          strategy={verticalListSortingStrategy}
        >
          <Stack component="ol" spacing={1.5} aria-label="Steps being edited" sx={{ m: 0, p: 0 }}>
            {editableSteps.map((editableStep, stepIndex) => (
              <ActionPlanStepFields
                key={editableStep.clientId}
                clientId={editableStep.clientId}
                stepNumber={stepIndex + 1}
                step={editableStep.step}
                isFirst={stepIndex === 0}
                isLast={stepIndex === editableSteps.length - 1}
                isDisabled={isSaving}
                onChange={handleStepChange}
                onMove={handleStepMove}
                onDelete={handleStepDelete}
              />
            ))}
          </Stack>
        </SortableContext>
      </DndContext>

      <Button
        startIcon={<AddIcon />}
        onClick={handleAddStepClick}
        disabled={isSaving || planIsFull}
        sx={{ mt: 1.5 }}
      >
        Add step
      </Button>

      {planHasProblems && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          <AlertTitle>Fix these before saving</AlertTitle>
          <List dense disablePadding aria-label="Plan problems">
            {planProblems.map((planProblem) => (
              <ListItem key={planProblem} disableGutters>
                <ListItemText primary={planProblem} />
              </ListItem>
            ))}
          </List>
        </Alert>
      )}
      {saveFailed && (
        <Alert severity="error" sx={{ mt: 2 }}>
          Could not save: {saveErrorMessage}
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <Button variant="contained" onClick={handleSaveClick} disabled={saveIsBlocked}>
          {isSaving ? "Saving…" : "Save as new version"}
        </Button>
        <Button onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
      </Stack>
    </Box>
  );
}
