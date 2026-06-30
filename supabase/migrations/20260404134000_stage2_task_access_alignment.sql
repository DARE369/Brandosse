-- Stage 2: Task system access alignment for dedicated member task workflows

DROP POLICY IF EXISTS org_workspace_member_read_tasks ON public.org_tasks;
DROP POLICY IF EXISTS org_workspace_member_insert_tasks ON public.org_tasks;
DROP POLICY IF EXISTS org_workspace_member_update_tasks ON public.org_tasks;
DROP POLICY IF EXISTS org_workspace_member_delete_tasks ON public.org_tasks;

CREATE POLICY org_workspace_member_read_tasks
  ON public.org_tasks
  FOR SELECT
  USING (
    assignee_user_id = auth.uid()
    OR created_by = auth.uid()
    OR public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
  );

CREATE POLICY org_workspace_admin_insert_tasks
  ON public.org_tasks
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
  );

CREATE POLICY org_workspace_member_update_task_status
  ON public.org_tasks
  FOR UPDATE
  USING (
    assignee_user_id = auth.uid()
    OR public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
  )
  WITH CHECK (
    assignee_user_id = auth.uid()
    OR public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
  );

CREATE POLICY org_workspace_admin_delete_tasks
  ON public.org_tasks
  FOR DELETE
  USING (
    public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
  );

CREATE OR REPLACE FUNCTION public.enforce_org_task_member_status_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.org_current_user_role(NEW.organization_id) IN ('org_owner', 'org_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.assignee_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the task assignee can update this task.';
  END IF;

  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.brand_project_id IS DISTINCT FROM OLD.brand_project_id
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.priority IS DISTINCT FROM OLD.priority
    OR NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.due_at IS DISTINCT FROM OLD.due_at
    OR NEW.blocked_reason IS DISTINCT FROM OLD.blocked_reason
    OR NEW.linked_post_id IS DISTINCT FROM OLD.linked_post_id
    OR NEW.linked_pipeline_item_id IS DISTINCT FROM OLD.linked_pipeline_item_id
    OR NEW.notes IS DISTINCT FROM OLD.notes
    OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
    RAISE EXCEPTION 'Assignees can only update task status.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_task_member_status_guard ON public.org_tasks;
CREATE TRIGGER trg_org_task_member_status_guard
  BEFORE UPDATE ON public.org_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_org_task_member_status_updates();
