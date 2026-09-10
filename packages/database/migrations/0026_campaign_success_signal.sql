ALTER TABLE campaign_workflow_command
  DROP CONSTRAINT IF EXISTS campaign_workflow_command_command_type_check;

ALTER TABLE campaign_workflow_command
  ADD CONSTRAINT campaign_workflow_command_command_type_check CHECK (command_type IN (
    'start', 'pause', 'resume', 'cancel', 'approval_decision', 'manual_step_completed',
    'success_criteria_met'
  ));
