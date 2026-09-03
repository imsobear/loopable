import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { RuleForm } from "@/components/rule-form";
import { getRuleById } from "@/server/functions/rules.ts";

export const Route = createFileRoute("/rules/$ruleId")({
  loader: async ({ params }) => {
    const rule = await getRuleById({ data: { id: params.ruleId } });
    if (!rule) throw notFound();
    return rule;
  },
  component: EditRulePage,
});

function EditRulePage() {
  const rule = Route.useLoaderData();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link
        to="/rules"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Rules
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{rule.name}</h1>
      <RuleForm rule={rule} />
    </div>
  );
}
