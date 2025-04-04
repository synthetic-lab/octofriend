import { t } from "structural";
import { ToolDef } from "../common.ts";

const AddStep = t.subtype({
  type: t.value("add-step"),
  step: t.str.comment(
    "A step in the plan. Must be a single, short sentence with no newlines or markdown"
  ),
});

const RemoveStep = t.subtype({
  type: t.value("remove-step"),
  id: t.num.comment("The id of the step to remove"),
});

const Clear = t.subtype({
  type: t.value("clear"),
}).comment("Proposes clearing the plan");

const SetPlan = t.subtype({
  type: t.value("set"),
  steps: t.array(t.str).comment(
    "An array of steps in the plan. Each step must be a single, short sentence with no newlines or markdown"
  ),
}).comment("Proposes setting a new plan. If a plan already exists, proposes overwriting the plan.");

const Updates = t.subtype({
  type: t.value("update"),
  changeset: t.array(AddStep.or(RemoveStep)),
}).comment("Proposes updating the current plan");

const Schema = t.subtype({
  name: t.value("plan"),
  params: t.subtype({
    operation: SetPlan.or(Clear).or(Updates),
  }),
}).comment(`
A planning tool. If you don't have a plan, talk to the user and decide what you want to do. Once you
decide what you're going to do, create a plan with concrete, small steps that can each be
accomplished with individual edits or tool calls.

After you complete tool calls and edits, update your plan: if you've completed an action item,
remove it. If you've discovered you need additional steps, add them.

Once you've finished your plan, clear it, or create a new plan.
`);

export default {
  Schema,
  validate: async () => null,
  async run(call, context) {
    const { operation } = call.tool.params;
    switch(operation.type) {
      case "set":
        context.tracker("plan").clear();
        for(const step of operation.steps) {
          context.tracker("plan").push(step);
        }
        return "Successfully set a new plan";
      case "clear":
        context.tracker("plan").clear();
        return "Successfully cleared the plan";
      case "update":
        for(const change of operation.changeset) {
          switch(change.type) {
            case "add-step":
              context.tracker("plan").push(change.step);
              break;
            case "remove-step":
              context.tracker("plan").remove(change.id);
              break;
          }
        }
        return "Successfully updated the plan";
    }
  },
} satisfies ToolDef<t.GetType<typeof Schema>>;
